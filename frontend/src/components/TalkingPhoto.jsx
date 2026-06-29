// "Talking Photo" — the loved one's REAL photo, animated to speak. A WebGL layer
// warps the mouth region (jaw drop + gentle width, a dark inner-mouth) driven by the
// same live voice signal as the 3D lip-sync, so the faithful likeness appears to talk.
// Fully local, no GPU model. Falls back to a static <img> if WebGL is unavailable.
//
// Honest: photo-real talking VIDEO needs an ML model (GPU/API). This is a subtle
// geometric approximation of the mouth opening, not a generated clip.
import React, { useEffect, useRef, useState } from 'react';
import { getMouthSignal } from '../lib/audiolevel';

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = vec2((a_pos.x + 1.0) / 2.0, 1.0 - (a_pos.y + 1.0) / 2.0);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG = `
precision mediump float;
uniform sampler2D u_tex;
uniform float u_open;       // 0..1 jaw open
uniform float u_wide;       // 0..1 lip spread (ee/s)
uniform float u_round;      // 0..1 lip purse (oo/m)
uniform vec2  u_uvScale;    // cover-fit (no distortion)
uniform vec2  u_uvOffset;
varying vec2 v_uv;
const vec2 MOUTH = vec2(0.5, 0.665);   // assumed mouth centre in the framed face
void main() {
  vec2 uv = v_uv;
  vec2 d = uv - MOUTH;
  float r = length(vec2(d.x / 0.20, d.y / 0.12));     // elliptical mouth region
  float fall = clamp(1.0 - r, 0.0, 1.0);
  fall = fall * fall * (3.0 - 2.0 * fall);            // smooth falloff
  float openAmt = u_open * 0.085 * fall;             // jaw drop (stronger, clearly visible)
  float s = uv.y > MOUTH.y ? 1.0 : -0.2;             // lower lip drops, upper barely moves
  uv.y -= s * openAmt;
  // horizontal: spread outward on wide (ee/s), pull inward on round (oo/m)
  uv.x += d.x * (u_wide * 0.055 - u_round * 0.05) * fall;
  vec2 tuv = clamp(uv * u_uvScale + u_uvOffset, 0.0, 1.0);
  vec4 col = texture2D(u_tex, tuv);
  float inner = clamp(1.0 - r * 1.7, 0.0, 1.0) * u_open;   // dark inner mouth as it opens
  col.rgb = mix(col.rgb, vec3(0.18, 0.06, 0.08), inner * 0.55);
  gl_FragColor = vec4(col.rgb, 1.0);
}`;

export default function TalkingPhoto({ src, isSpeaking = false, name }) {
    const canvasRef = useRef(null);
    const speakingRef = useRef(isSpeaking);
    const stateRef = useRef({ raf: 0, open: 0, wide: 0, round: 0 });
    const [glFailed, setGlFailed] = useState(false);

    useEffect(() => { speakingRef.current = isSpeaking; }, [isSpeaking]);

    useEffect(() => {
        if (glFailed) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false });
        if (!gl) { setGlFailed(true); return; }

        const sh = (type, code) => { const s = gl.createShader(type); gl.shaderSource(s, code); gl.compileShader(s); return s; };
        const prog = gl.createProgram();
        gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
        gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { setGlFailed(true); return; }
        gl.useProgram(prog);

        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const aPos = gl.getAttribLocation(prog, 'a_pos');
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
        const uOpen = gl.getUniformLocation(prog, 'u_open');
        const uWide = gl.getUniformLocation(prog, 'u_wide');
        const uRound = gl.getUniformLocation(prog, 'u_round');
        const uScale = gl.getUniformLocation(prog, 'u_uvScale');
        const uOffset = gl.getUniformLocation(prog, 'u_uvOffset');

        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([210, 210, 214, 255]));

        let scale = [1, 1], offset = [0, 0];
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img); }
            catch (e) { setGlFailed(true); return; }
            const a = img.naturalWidth / Math.max(1, img.naturalHeight);  // cover-fit a square
            if (a >= 1) { scale = [1 / a, 1]; offset = [(1 - 1 / a) / 2, 0]; }
            else { scale = [1, a]; offset = [0, (1 - a) / 2]; }
        };
        img.onerror = () => setGlFailed(true);
        img.src = src;

        const st = stateRef.current;
        const loop = () => {
            const target = speakingRef.current ? getMouthSignal() : { open: 0, wide: 0, round: 0 };
            const sp = speakingRef.current;
            st.open += ((sp ? target.open : 0) - st.open) * 0.32;
            st.wide += ((sp ? (target.wide || 0) : 0) - st.wide) * 0.26;
            st.round += ((sp ? (target.round || 0) : 0) - st.round) * 0.26;
            gl.viewport(0, 0, canvas.width, canvas.height);
            gl.uniform1f(uOpen, st.open);
            gl.uniform1f(uWide, st.wide);
            gl.uniform1f(uRound, st.round);
            gl.uniform2f(uScale, scale[0], scale[1]);
            gl.uniform2f(uOffset, offset[0], offset[1]);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            st.raf = requestAnimationFrame(loop);
        };
        st.raf = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(st.raf);
    }, [src, glFailed]);

    return (
        <div className={`tp ${isSpeaking ? 'speaking' : ''}`}>
            <div className="tp-glow" />
            <div className="tp-frame">
                {glFailed
                    ? <img src={src} alt={name || 'companion'} className="tp-media" />
                    : <canvas ref={canvasRef} width={512} height={512} className="tp-media" />}
            </div>
            <style>{`
        .tp { position: relative; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
        .tp-glow {
            position: absolute; width: 460px; height: 460px; max-width: 82%; max-height: 82%; border-radius: 50%;
            background: radial-gradient(closest-side, rgba(124,58,237,0.42), rgba(37,99,235,0.16), transparent 75%);
            filter: blur(10px); transition: opacity .3s; opacity: 0.65;
        }
        .tp.speaking .tp-glow { opacity: 1; animation: tp-pulse 1.2s ease-in-out infinite; }
        .tp-frame {
            position: relative; width: 380px; height: 380px; max-width: 72%; max-height: 72%;
            border-radius: 50%; overflow: hidden; border: 4px solid var(--border-strong);
            box-shadow: 0 30px 80px rgba(15,23,42,0.30); transition: transform .2s;
        }
        .tp.speaking .tp-frame { animation: tp-breathe 2.4s ease-in-out infinite; border-color: rgba(74,222,128,0.55); }
        .tp-media { width: 100%; height: 100%; object-fit: cover; display: block; }
        @keyframes tp-pulse { 0%,100% { transform: scale(1); opacity: .8; } 50% { transform: scale(1.06); opacity: 1; } }
        @keyframes tp-breathe { 0%,100% { transform: scale(1); } 50% { transform: scale(1.03); } }
      `}</style>
        </div>
    );
}
