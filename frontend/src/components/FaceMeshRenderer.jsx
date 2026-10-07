/**
 * FaceMeshRenderer.jsx
 * React Three Fiber component that renders the 478-point face mesh.
 * Two styles: "realistic" (soft skin surface) and "ai-mesh" (wireframe + glow dots).
 *
 * Props:
 *   frame        FaceMeshFrame | null  — latest face mesh data
 *   style        "realistic" | "ai-mesh"
 *   isSpeaking   boolean
 */
import React, { useRef, useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Points, PointMaterial } from '@react-three/drei';
import * as THREE from 'three';
import { getLevel } from '../lib/audiolevel';

// ─── Constants ────────────────────────────────────────────────────────────────
const SKIN_COLOR   = new THREE.Color('#d4a98a');  // warm skin tone
const WIRE_COLOR   = new THREE.Color('#7c3aed');   // purple mesh lines
const DOT_COLOR    = new THREE.Color('#a78bfa');   // lighter purple dots
const GLOW_COLOR   = new THREE.Color('#4f46e5');   // deep indigo glow

// MediaPipe landmarks are normalized [0,1] in camera space.
// Map them into Three.js world space: x→[-1.5,1.5] y→[-1.5,1.5] z depth
function landmarkToVec3(p, scaleX = 3, scaleY = 3, scaleZ = 2.5) {
    return [
        (p.x - 0.5) * scaleX * -1,   // flip x (mirror)
        (p.y - 0.5) * scaleY * -1,   // flip y (screen y is inverted)
        (p.z || 0) * scaleZ,
    ];
}

// ─── Face geometry updater ────────────────────────────────────────────────────
function useFaceGeometry(frame, style) {
    const geoRef  = useRef(null);
    const wireRef = useRef(null);
    const dotsRef = useRef(null);   // Float32Array positions for Points

    // Build geometry once, update positions each frame
    useEffect(() => {
        const n = 478;
        const posArr = new Float32Array(n * 3);
        const triCount = frame?.triangles?.length || 0;
        const idxArr = new Uint16Array(triCount * 3);

        if (frame?.triangles) {
            for (let i = 0; i < triCount; i++) {
                const [a, b, c] = frame.triangles[i];
                idxArr[i * 3] = a; idxArr[i * 3 + 1] = b; idxArr[i * 3 + 2] = c;
            }
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
        geo.setIndex(new THREE.BufferAttribute(idxArr, 1));
        geo.computeVertexNormals();
        geoRef.current = geo;

        // Wire geometry shares the same position buffer
        if (style === 'ai-mesh') {
            const wireGeo = new THREE.WireframeGeometry(geo);
            wireRef.current = wireGeo;
        }

        // Dots buffer (same positions)
        const dotsPos = new Float32Array(n * 3);
        dotsRef.current = dotsPos;

        return () => {
            geo.dispose();
            if (wireRef.current) { wireRef.current.dispose(); wireRef.current = null; }
            geoRef.current = null;
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [style]);

    return { geoRef, wireRef, dotsRef };
}

// ─── Realistic Face Mesh ──────────────────────────────────────────────────────
function RealisticMesh({ frame, isSpeaking }) {
    const meshRef  = useRef();
    const { geoRef } = useFaceGeometry(frame, 'realistic');
    const geo = useMemo(() => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(478 * 3), 3));
        if (frame?.triangles) {
            const idx = new Uint16Array(frame.triangles.length * 3);
            frame.triangles.forEach(([a,b,c], i) => { idx[i*3]=a; idx[i*3+1]=b; idx[i*3+2]=c; });
            g.setIndex(new THREE.BufferAttribute(idx, 1));
        }
        return g;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useFrame(() => {
        if (!frame?.points || !meshRef.current) return;
        const pos = meshRef.current.geometry.attributes.position;
        const pts = frame.points;
        for (let i = 0; i < pts.length; i++) {
            const [x, y, z] = landmarkToVec3(pts[i]);
            pos.setXYZ(i, x, y, z);
        }
        pos.needsUpdate = true;
        meshRef.current.geometry.computeVertexNormals();

        // Gentle breathing when speaking
        if (isSpeaking) {
            const lv = getLevel();
            meshRef.current.scale.setScalar(1 + lv * 0.012);
        } else {
            meshRef.current.scale.setScalar(1);
        }
    });

    return (
        <mesh ref={meshRef} geometry={geo} frustumCulled={false}>
            <meshPhongMaterial
                color={SKIN_COLOR}
                shininess={30}
                specular={new THREE.Color(0.15, 0.1, 0.1)}
                side={THREE.DoubleSide}
                transparent
                opacity={0.93}
            />
        </mesh>
    );
}

// ─── AI Mesh (wireframe + glow) ───────────────────────────────────────────────
function AiMesh({ frame, isSpeaking }) {
    const meshRef  = useRef();
    const wireRef  = useRef();
    const pointsRef = useRef();
    const clock = useRef(0);

    const geo = useMemo(() => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(478 * 3), 3));
        if (frame?.triangles) {
            const idx = new Uint16Array(frame.triangles.length * 3);
            frame.triangles.forEach(([a,b,c], i) => { idx[i*3]=a; idx[i*3+1]=b; idx[i*3+2]=c; });
            g.setIndex(new THREE.BufferAttribute(idx, 1));
        }
        return g;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const wireGeo = useMemo(() => new THREE.WireframeGeometry(geo), [geo]);

    const dotPositions = useMemo(() => new Float32Array(478 * 3), []);

    useFrame((_, delta) => {
        clock.current += delta;
        const t = clock.current;
        const lv = isSpeaking ? getLevel() : 0;

        if (!frame?.points) return;
        const pts = frame.points;

        // Update main geometry
        const pos = geo.attributes.position;
        for (let i = 0; i < pts.length; i++) {
            const [x, y, z] = landmarkToVec3(pts[i]);
            pos.setXYZ(i, x, y, z);
            dotPositions[i*3]   = x;
            dotPositions[i*3+1] = y;
            dotPositions[i*3+2] = z;
        }
        pos.needsUpdate = true;
        geo.computeVertexNormals();

        // Update wireframe (it follows the same buffer automatically)
        if (wireRef.current?.geometry?.attributes?.position) {
            wireRef.current.geometry.attributes.position.needsUpdate = true;
        }

        // Update dots
        if (pointsRef.current) {
            pointsRef.current.geometry.setAttribute(
                'position',
                new THREE.BufferAttribute(dotPositions.slice(), 3)
            );
        }

        // Pulse scale with voice
        const scale = 1 + lv * 0.018 + Math.sin(t * 2.1) * 0.005;
        if (meshRef.current) meshRef.current.scale.setScalar(scale);
        if (wireRef.current) wireRef.current.scale.setScalar(scale);
        if (pointsRef.current) pointsRef.current.scale.setScalar(scale);

        // Animate wire color with isSpeaking
        if (wireRef.current?.material) {
            const bright = 0.5 + lv * 0.5 + Math.sin(t * 3) * 0.1;
            wireRef.current.material.color.setRGB(
                WIRE_COLOR.r * bright,
                WIRE_COLOR.g * bright,
                WIRE_COLOR.b * (0.7 + bright * 0.3)
            );
        }
    });

    return (
        <group>
            {/* Invisible filled face — so points appear on a surface */}
            <mesh ref={meshRef} geometry={geo} frustumCulled={false}>
                <meshBasicMaterial
                    color="#0f0c2e"
                    transparent
                    opacity={0.5}
                    side={THREE.DoubleSide}
                />
            </mesh>

            {/* Purple wireframe */}
            <lineSegments ref={wireRef} geometry={wireGeo} frustumCulled={false}>
                <lineBasicMaterial color={WIRE_COLOR} transparent opacity={0.75} linewidth={1} />
            </lineSegments>

            {/* Glowing landmark dots */}
            <points ref={pointsRef} frustumCulled={false}>
                <bufferGeometry>
                    <bufferAttribute
                        attach="attributes-position"
                        array={dotPositions}
                        count={478}
                        itemSize={3}
                    />
                </bufferGeometry>
                <pointsMaterial
                    color={DOT_COLOR}
                    size={0.012}
                    transparent
                    opacity={0.9}
                    sizeAttenuation
                />
            </points>
        </group>
    );
}

// ─── No-face placeholder ──────────────────────────────────────────────────────
function ScanningRing() {
    const ref = useRef();
    useFrame((_, delta) => {
        if (ref.current) ref.current.rotation.y += delta * 1.2;
    });
    return (
        <group ref={ref}>
            <mesh>
                <torusGeometry args={[0.7, 0.008, 8, 64]} />
                <meshBasicMaterial color="#7c3aed" transparent opacity={0.5} />
            </mesh>
            <mesh rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[0.7, 0.005, 8, 64]} />
                <meshBasicMaterial color="#4f46e5" transparent opacity={0.35} />
            </mesh>
        </group>
    );
}

// ─── Lighting ─────────────────────────────────────────────────────────────────
function Lights({ style }) {
    return (
        <>
            <ambientLight intensity={style === 'ai-mesh' ? 0.1 : 0.6} />
            {style === 'realistic' ? (
                <>
                    <directionalLight position={[0, 2, 4]} intensity={0.8} color="#f8f0ff" />
                    <directionalLight position={[-2, 1, 2]} intensity={0.4} color="#dbeafe" />
                    <pointLight position={[0, -1, 2]} intensity={0.3} color="#ffd0a0" />
                </>
            ) : (
                <>
                    <pointLight position={[0, 0, 3]} intensity={2.0} color="#7c3aed" distance={8} />
                    <pointLight position={[1, 1, 1]} intensity={1.0} color="#4f46e5" distance={6} />
                    <ambientLight intensity={0.05} />
                </>
            )}
        </>
    );
}

// ─── Main export ──────────────────────────────────────────────────────────────
export default function FaceMeshRenderer({ frame, style = 'ai-mesh', isSpeaking = false }) {
    const hasPoints = frame?.points && frame.points.length > 0;

    return (
        <>
            <Lights style={style} />
            {hasPoints
                ? style === 'realistic'
                    ? <RealisticMesh frame={frame} isSpeaking={isSpeaking} />
                    : <AiMesh       frame={frame} isSpeaking={isSpeaking} />
                : <ScanningRing />
            }
        </>
    );
}
