import React, { useEffect, useRef, useState } from 'react';
import {
  AnimatePresence,
  motion,
  useInView,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from 'framer-motion';

const EASE = [0.22, 1, 0.36, 1];

function useMotionPreference() {
  const systemReduced = useReducedMotion();
  const [userReduced, setUserReduced] = useState(() => (
    typeof document !== 'undefined'
      && document.documentElement.dataset.reduceMotion === 'true'
  ));

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      setUserReduced(root.dataset.reduceMotion === 'true');
    });
    observer.observe(root, { attributes: true, attributeFilter: ['data-reduce-motion'] });
    return () => observer.disconnect();
  }, []);

  return Boolean(systemReduced || userReduced);
}

export function ScrollReveal({
  children,
  direction = 'up',
  delay = 0,
  duration = 0.55,
  distance = 16,
  className = '',
  once = true,
  amount = 0.24,
  rootRef,
}) {
  const ref = useRef(null);
  const reduced = useMotionPreference();
  const isInView = useInView(ref, {
    once,
    amount,
    margin: '0px 0px -8% 0px',
    root: rootRef,
  });
  const hiddenX = direction === 'left' ? distance : direction === 'right' ? -distance : 0;
  const hiddenY = direction === 'up' ? distance : direction === 'down' ? -distance : 0;

  return (
    <motion.div
      ref={ref}
      initial={reduced ? false : { opacity: 0, x: hiddenX, y: hiddenY, filter: 'blur(4px)' }}
      animate={reduced || isInView ? { opacity: 1, x: 0, y: 0, filter: 'blur(0px)' } : { opacity: 0, x: hiddenX, y: hiddenY, filter: 'blur(4px)' }}
      transition={reduced ? { duration: 0 } : { duration, delay, ease: EASE }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function ScrollParallax({
  children,
  distance = 20,
  axis = 'y',
  className = '',
  targetRef,
  containerRef,
}) {
  const reduced = useMotionPreference();
  const scrollOptions = targetRef
    ? { target: targetRef, offset: ['start end', 'end start'], ...(containerRef ? { container: containerRef } : {}) }
    : containerRef
      ? { container: containerRef }
      : {};
  const { scrollYProgress } = useScroll(scrollOptions);
  const smoothProgress = useSpring(scrollYProgress, { stiffness: 100, damping: 28, restDelta: 0.001 });
  const offset = useTransform(smoothProgress, [0, 1], [-distance, distance]);

  return (
    <motion.div
      className={className}
      style={{ x: axis === 'x' && !reduced ? offset : 0, y: axis === 'y' && !reduced ? offset : 0 }}
    >
      {children}
    </motion.div>
  );
}

// Backwards-compatible helper used by a few existing screens.
export function ParallaxElement({ children, speed = 0.2, distance = 100, direction = 'up', className = '' }) {
  const reduced = useMotionPreference();
  const { scrollYProgress } = useScroll();
  const y = useTransform(
    scrollYProgress,
    [0, 1],
    direction === 'up' ? [0, -distance * speed] : [0, distance * speed],
  );
  return <motion.div style={{ y: reduced ? 0 : y }} className={className}>{children}</motion.div>;
}

export function Surface({ children, className = '', interactive = false }) {
  const reduced = useMotionPreference();
  return (
    <motion.div
      className={`ui-surface ${interactive ? 'ui-surface--interactive' : ''} ${className}`}
      whileHover={interactive && !reduced ? { y: -2 } : undefined}
      whileTap={interactive && !reduced ? { scale: 0.995 } : undefined}
      transition={{ type: 'spring', stiffness: 320, damping: 28 }}
    >
      {children}
    </motion.div>
  );
}

export function GlassCard({ children, className = '', hoverScale = 1.01, borderGlow = false }) {
  const reduced = useMotionPreference();
  return (
    <motion.div
      whileHover={reduced ? undefined : { scale: hoverScale, y: -3 }}
      transition={{ type: 'spring', stiffness: 300, damping: 24 }}
      className={`ui-card ui-card-hover ${borderGlow ? 'ui-card-glow' : ''} ${className}`}
    >
      {children}
    </motion.div>
  );
}

export function MagneticButton({ children, className = '', ...props }) {
  const ref = useRef(null);
  const reduced = useMotionPreference();

  const handleMouseMove = (event) => {
    if (reduced || !ref.current) return;
    const { clientX, clientY } = event;
    const { left, top, width, height } = ref.current.getBoundingClientRect();
    const moveX = (clientX - (left + width / 2)) * 0.12;
    const moveY = (clientY - (top + height / 2)) * 0.12;
    ref.current.style.transform = `translate3d(${moveX}px, ${moveY}px, 0)`;
  };

  const handleMouseLeave = () => {
    if (ref.current) ref.current.style.transform = 'translate3d(0, 0, 0)';
  };

  return (
    <motion.button
      ref={ref}
      {...props}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className={`ui-magnetic ${className}`}
    >
      {children}
    </motion.button>
  );
}

export function StaggerContainer({ children, delay = 0, stagger = 0.08, className = '' }) {
  const reduced = useMotionPreference();
  const containerVariants = {
    hidden: { opacity: reduced ? 1 : 0 },
    visible: {
      opacity: 1,
      transition: reduced ? { duration: 0 } : { delayChildren: delay, staggerChildren: stagger },
    },
  };
  const itemVariants = {
    hidden: reduced ? { opacity: 1 } : { opacity: 0, y: 12 },
    visible: reduced
      ? { opacity: 1 }
      : { opacity: 1, y: 0, transition: { duration: 0.42, ease: EASE } },
  };

  return (
    <motion.div
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.18 }}
      variants={containerVariants}
      className={className}
    >
      {React.Children.map(children, (child) => (
        <motion.div variants={itemVariants}>{child}</motion.div>
      ))}
    </motion.div>
  );
}

export function PageTransition({ routeKey, children }) {
  const reduced = useMotionPreference();
  return (
    <AnimatePresence initial={false} mode="wait">
      <motion.div
        key={routeKey}
        className="route-transition"
        initial={reduced ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={reduced ? { opacity: 1 } : { opacity: 0, y: -8 }}
        transition={reduced ? { duration: 0 } : { duration: 0.34, ease: EASE }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

export function ScrollProgress({ containerRef }) {
  const { scrollYProgress } = useScroll(containerRef ? { container: containerRef } : undefined);
  return <motion.div className="route-progress" style={{ scaleX: scrollYProgress }} aria-hidden="true" />;
}

export function BottomSheet({ open, onClose, title, children }) {
  const sheetRef = useRef(null);
  const previousFocusRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    previousFocusRef.current = document.activeElement;
    const focusableSelector = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusFirst = () => sheetRef.current?.querySelector(focusableSelector)?.focus();
    const frame = window.requestAnimationFrame(focusFirst);
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose?.();
        return;
      }
      if (event.key !== 'Tab' || !sheetRef.current) return;
      const focusable = [...sheetRef.current.querySelectorAll(focusableSelector)];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKeyDown);
      previousFocusRef.current?.focus?.();
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="ui-sheet-scrim"
          role="presentation"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}
        >
          <motion.section
            ref={sheetRef}
            className="ui-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ui-sheet-title"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 360, damping: 34 }}
          >
            <div className="ui-sheet-handle" aria-hidden="true" />
            <div className="ui-sheet-head">
              <h2 id="ui-sheet-title">{title}</h2>
              <button type="button" className="ui-icon-btn" onClick={onClose} aria-label="Close menu">×</button>
            </div>
            {children}
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
