import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

/*
 * Hero scene: a slowly turning DNA double helix made of glowing nodes, a
 * pulse ring like a heartbeat monitor, and drifting particles. The camera
 * leans toward the pointer. Pauses when scrolled out of view.
 */

const TEAL = new THREE.Color('#2dd4bf');
const CYAN = new THREE.Color('#22d3ee');
const MINT = new THREE.Color('#a7f3d0');

function Helix({ reduced }) {
    const group = useRef();
    const nodes = useRef();
    const rungs = useRef();
    const COUNT = 46;
    const HEIGHT = 9;
    const RADIUS = 1.35;

    const { positions, rungData } = useMemo(() => {
        const positions = [];
        const rungData = [];
        for (let i = 0; i < COUNT; i++) {
            const t = i / (COUNT - 1);
            const y = (t - 0.5) * HEIGHT;
            const a = t * Math.PI * 4.2;
            const p1 = new THREE.Vector3(Math.cos(a) * RADIUS, y, Math.sin(a) * RADIUS);
            const p2 = new THREE.Vector3(Math.cos(a + Math.PI) * RADIUS, y, Math.sin(a + Math.PI) * RADIUS);
            positions.push(p1, p2);
            if (i % 2 === 0) rungData.push([p1, p2]);
        }
        return { positions, rungData };
    }, []);

    useEffect(() => {
        const m = new THREE.Matrix4();
        positions.forEach((p, i) => {
            const s = 0.07 + (i % 7 === 0 ? 0.04 : 0);
            m.compose(p, new THREE.Quaternion(), new THREE.Vector3(s, s, s));
            nodes.current.setMatrixAt(i, m);
            nodes.current.setColorAt(i, i % 2 ? CYAN : TEAL);
        });
        nodes.current.instanceMatrix.needsUpdate = true;
        if (nodes.current.instanceColor) nodes.current.instanceColor.needsUpdate = true;

        const up = new THREE.Vector3(0, 1, 0);
        rungData.forEach(([a, b], i) => {
            const mid = a.clone().add(b).multiplyScalar(0.5);
            const dir = b.clone().sub(a);
            const q = new THREE.Quaternion().setFromUnitVectors(up, dir.clone().normalize());
            m.compose(mid, q, new THREE.Vector3(1, dir.length(), 1));
            rungs.current.setMatrixAt(i, m);
        });
        rungs.current.instanceMatrix.needsUpdate = true;
    }, [positions, rungData]);

    useFrame((state, dt) => {
        if (reduced) return;
        group.current.rotation.y += dt * 0.25;
        group.current.position.y = Math.sin(state.clock.elapsedTime * 0.6) * 0.15;
    });

    return (
        <group ref={group} rotation={[0.12, 0, -0.32]}>
            <instancedMesh ref={nodes} args={[undefined, undefined, positions.length]}>
                <sphereGeometry args={[1, 20, 20]} />
                <meshStandardMaterial emissive={TEAL} emissiveIntensity={0.9} roughness={0.25} metalness={0.2} toneMapped={false} />
            </instancedMesh>
            <instancedMesh ref={rungs} args={[undefined, undefined, rungData.length]}>
                <cylinderGeometry args={[0.022, 0.022, 1, 8]} />
                <meshStandardMaterial color={MINT} emissive={MINT} emissiveIntensity={0.35} transparent opacity={0.55} />
            </instancedMesh>
        </group>
    );
}

function PulseRings({ reduced }) {
    const rings = [useRef(), useRef(), useRef()];
    useFrame((state) => {
        rings.forEach((r, i) => {
            if (!r.current) return;
            const t = reduced ? 0.4 : ((state.clock.elapsedTime * 0.35 + i / 3) % 1);
            const s = 1.6 + t * 2.6;
            r.current.scale.set(s, s, s);
            r.current.material.opacity = (1 - t) * 0.35;
        });
    });
    return (
        <group rotation={[Math.PI / 2.3, 0, 0]} position={[0, -0.3, 0]}>
            {rings.map((r, i) => (
                <mesh key={i} ref={r}>
                    <torusGeometry args={[1, 0.008, 8, 120]} />
                    <meshBasicMaterial color={CYAN} transparent opacity={0.3} toneMapped={false} />
                </mesh>
            ))}
        </group>
    );
}

function Particles({ count = 420, reduced }) {
    const ref = useRef();
    const geo = useMemo(() => {
        const g = new THREE.BufferGeometry();
        const p = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
            const r = 4 + Math.random() * 9;
            const th = Math.random() * Math.PI * 2;
            const ph = Math.acos(2 * Math.random() - 1);
            p[i * 3] = r * Math.sin(ph) * Math.cos(th);
            p[i * 3 + 1] = (Math.random() - 0.5) * 12;
            p[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th) - 3;
        }
        g.setAttribute('position', new THREE.BufferAttribute(p, 3));
        return g;
    }, [count]);
    useFrame((_, dt) => { if (!reduced) ref.current.rotation.y -= dt * 0.02; });
    return (
        <points ref={ref} geometry={geo}>
            <pointsMaterial size={0.045} color="#99f6e4" transparent opacity={0.7} sizeAttenuation depthWrite={false} />
        </points>
    );
}

function CameraRig({ reduced }) {
    const { camera, pointer } = useThree();
    useFrame(() => {
        if (reduced) return;
        camera.position.x += (pointer.x * 1.2 - camera.position.x) * 0.04;
        camera.position.y += (pointer.y * 0.8 - camera.position.y) * 0.04;
        camera.lookAt(0, 0, 0);
    });
    return null;
}

export default function HealthScene({ reduced = false }) {
    const wrap = useRef(null);
    const [visible, setVisible] = useState(true);
    useEffect(() => {
        const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0 });
        if (wrap.current) io.observe(wrap.current);
        return () => io.disconnect();
    }, []);

    return (
        <div ref={wrap} className="absolute inset-0" aria-hidden>
            <Canvas frameloop={visible ? 'always' : 'never'} dpr={[1, 1.75]} camera={{ position: [0, 0, 8.5], fov: 45 }} gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}>
                <ambientLight intensity={0.5} />
                <pointLight position={[4, 4, 6]} intensity={40} color="#5eead4" />
                <pointLight position={[-5, -3, 2]} intensity={25} color="#22d3ee" />
                <group position={[3.1, 0, -1]} scale={0.72}>
                    <Helix reduced={reduced} />
                    <PulseRings reduced={reduced} />
                </group>
                <Particles reduced={reduced} />
                <CameraRig reduced={reduced} />
            </Canvas>
        </div>
    );
}
