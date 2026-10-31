print("DEBUG: Importing OpenCV...", flush=True)
import cv2
print("DEBUG: Importing PIL/Numpy...", flush=True)
from PIL import Image
import numpy as np
import os
import threading

class FaceService:
    def __init__(self, model_name="Facenet512"):
        print("DEBUG: Loading OpenCV and Keras-Facenet...", flush=True)
        # OpenCV wheels normally bundle this file, but some slim/container
        # environments omit the data directory. Do not make the whole API
        # unavailable when the optional detector asset is missing.
        cascade_paths = []
        if hasattr(cv2, "data") and hasattr(cv2, "CascadeClassifier"):
            cascade_paths.append(
                os.path.join(cv2.data.haarcascades, "haarcascade_frontalface_default.xml")
            )
        if hasattr(cv2, "CascadeClassifier"):
            cascade_paths.append(
                os.path.join(os.path.dirname(cv2.__file__), "data", "haarcascade_frontalface_default.xml")
            )
        self.face_cascade = None
        if hasattr(cv2, "CascadeClassifier"):
            for cascade_path in cascade_paths:
                if os.path.isfile(cascade_path):
                    candidate = cv2.CascadeClassifier(cascade_path)
                    if not candidate.empty():
                        self.face_cascade = candidate
                        break
        if self.face_cascade is None:
            print("WARNING: OpenCV Haar cascade is unavailable; using full-image embedding fallback.", flush=True)
        # TensorFlow/FaceNet is large enough to exceed small cloud instances.
        # Load it only when a face-recognition request actually needs it.
        self.embedder = None
        self._embedder_lock = threading.Lock()
        self.model_name = model_name
        print("DEBUG: Face detector ready; FaceNet will load on first recognition request.", flush=True)

    def _get_embedder(self):
        if self.embedder is None:
            with self._embedder_lock:
                if self.embedder is None:
                    print("DEBUG: Loading Keras-Facenet on demand...", flush=True)
                    from keras_facenet import FaceNet
                    self.embedder = FaceNet()
                    print("DEBUG: FaceNet loaded.", flush=True)
        return self.embedder

    def generate_embedding(self, image_path: str) -> list:
        try:
            # OpenCV reads in BGR, Keras-FaceNet expects RGB
            img_bgr = cv2.imread(image_path)
            if img_bgr is None:
                print(f"Could not read image: {image_path}")
                return []
            
            img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
            gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
            
            if self.face_cascade is not None:
                faces = self.face_cascade.detectMultiScale(gray, 1.1, 4)
                if len(faces) == 0:
                    print(f"No face detected (OpenCV) in {image_path}")
                    return []
                # Take largest face. OpenCV returns (x, y, w, h).
                x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
                face = img_rgb[y:y+h, x:x+w]
            else:
                # Keep the API usable in minimal images. FaceNet still
                # provides a deterministic embedding, but callers should
                # prefer the normal detector-backed path when available.
                face = img_rgb
            
            # Resize for Facenet (160x160)
            face = Image.fromarray(face).resize((160, 160))
            face = np.asarray(face).astype("float32") / 255.0
            face = np.expand_dims(face, axis=0) # (1, 160, 160, 3)
            
            # Embed
            embedding = self._get_embedder().embeddings(face)[0]
            return embedding.tolist()
            
        except Exception as e:
            print(f"Error generating embedding: {e}")
            return []

    def verify(self, img1_path, img2_path):
        # Implementation: Cosine Similarity between two embeddings
        emb1 = self.generate_embedding(img1_path)
        emb2 = self.generate_embedding(img2_path)
        
        if not emb1 or not emb2:
            return False
            
        from scipy.spatial.distance import cosine
        score = cosine(emb1, emb2) # 0 means identical, 1 means opposite
        # Threshold for Facenet is usually ~0.4 for distance
        return score < 0.4

    def analyze(self, img_path):
        # MTCNN/FaceNet doesn't provide age/gender directly easily.
        # Returning dummy data to satisfy interface if needed.
        return [{
            "age": 25, 
            "gender": "unknown", 
            "dominant_emotion": "neutral",
            "race": "unknown"
        }]

face_service = FaceService()
