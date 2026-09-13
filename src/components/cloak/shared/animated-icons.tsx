"use client";

/*
 * Animated nav icons from lucide-animated.com (user feedback round 5).
 * Both animate on hover on pointer devices and expose imperative
 * start/stop handles; on touch devices the app shell drives them with
 * useIconPressAnimation (press -> animate for two seconds).
 */

import { cn } from "@/lib/utils";
import type { Variants } from "framer-motion";
import {
  LazyMotion,
  domMin,
  m,
  motion,
  useAnimation,
  useReducedMotion,
} from "framer-motion";
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  type HTMLAttributes,
} from "react";

export interface MessageCircleMoreIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface MessageCircleMoreIconProps
  extends Omit<
    HTMLAttributes<HTMLDivElement>,
    | "color"
    | "onDrag"
    | "onDragStart"
    | "onDragEnd"
    | "onAnimationStart"
    | "onAnimationEnd"
    | "onAnimationIteration"
  > {
  size?: number;
  duration?: number;
  isAnimated?: boolean;
  color?: string;
}

const MessageCircleMoreIcon = forwardRef<
  MessageCircleMoreIconHandle,
  MessageCircleMoreIconProps
>(
  (
    {
      onMouseEnter,
      onMouseLeave,
      className,
      size = 24,
      duration = 1,
      isAnimated = true,
      color,
      ...props
    },
    ref,
  ) => {
    const controls = useAnimation();
    const reduced = useReducedMotion();
    const isControlled = useRef(false);

    useImperativeHandle(ref, () => {
      isControlled.current = true;
      return {
        /* The imperative handle is the press-feedback path (2s hold on
           touch devices) — it always runs: it is a direct response to
           the user's own tap, not autonomous motion. The hover path
           below keeps the reduced-motion check. */
        startAnimation: () => controls.start("animate"),
        /* Round 15: the stop must be SILENT — keyframes already end at
           rest, and an animated return would read as a second animation
           two seconds after the press (user report, round 15). */
        stopAnimation: () => controls.start("normal", { duration: 0 }),
      };
    });

    const handleEnter = useCallback(
      (e?: React.MouseEvent<HTMLDivElement>) => {
        if (!isAnimated || reduced) return;
        if (!isControlled.current) controls.start("animate");
        else onMouseEnter?.(e as any);
      },
      [controls, reduced, isAnimated, onMouseEnter],
    );

    const handleLeave = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        if (!isControlled.current) {
          controls.start("normal");
        } else {
          onMouseLeave?.(e as any);
        }
      },
      [controls, onMouseLeave],
    );

    const bubbleVariants: Variants = {
      normal: { scale: 1, opacity: 1 },
      animate: {
        scale: [0.3, 1.05, 1],
        opacity: [0, 1, 1],
        transition: {
          duration: 0.55 * duration,
          times: [0, 0.7, 1],
          ease: [0.34, 1.4, 0.64, 1],
        },
      },
    };

    const dotVariants: Variants = {
      normal: { scale: 1, opacity: 1 },
      animate: (i: number) => ({
        scale: [0, 1.3, 1],
        opacity: [0, 1, 1],
        transition: {
          duration: 0.4 * duration,
          delay: (0.26 + i * 0.12) * duration,
          times: [0, 0.6, 1],
          ease: [0.34, 1.4, 0.64, 1],
        },
      }),
    };

    return (
      <LazyMotion features={domMin} strict>
        <m.div
          className={cn("inline-flex items-center justify-center", className)}
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
          {...props}
          style={{ color, ...props.style }}
        >
          <m.svg
            xmlns="http://www.w3.org/2000/svg"
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            animate={controls}
            initial="normal"
          >
            <m.path
              d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"
              variants={bubbleVariants}
              style={{ transformBox: "view-box", originX: "4px", originY: "20px" }}
            />
            <m.path
              d="M8 12h.01"
              custom={0}
              variants={dotVariants}
              style={{ transformBox: "view-box", originX: "8px", originY: "12px" }}
            />
            <m.path
              d="M12 12h.01"
              custom={1}
              variants={dotVariants}
              style={{ transformBox: "view-box", originX: "12px", originY: "12px" }}
            />
            <m.path
              d="M16 12h.01"
              custom={2}
              variants={dotVariants}
              style={{ transformBox: "view-box", originX: "16px", originY: "12px" }}
            />
          </m.svg>
        </m.div>
      </LazyMotion>
    );
  },
);

MessageCircleMoreIcon.displayName = "MessageCircleMoreIcon";
export { MessageCircleMoreIcon };

export interface CogIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface CogIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const CogIcon = forwardRef<CogIconHandle, CogIconProps>(
  ({ onMouseEnter, onMouseLeave, className, size = 28, ...props }, ref) => {
    const controls = useAnimation();
    const isControlledRef = useRef(false);

    useImperativeHandle(ref, () => {
      isControlledRef.current = true;

      return {
        startAnimation: () => controls.start("animate"),
        /* Round 15: the stop must be SILENT — the keyframes already end
           at rest, and an animated return would read as a second
           animation two seconds after the press (user report). */
        stopAnimation: () => controls.start("normal", { duration: 0 }),
      };
    });

    const handleMouseEnter = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        if (isControlledRef.current) {
          onMouseEnter?.(e);
        } else {
          controls.start("animate");
        }
      },
      [controls, onMouseEnter],
    );

    const handleMouseLeave = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        if (isControlledRef.current) {
          onMouseLeave?.(e);
        } else {
          controls.start("normal");
        }
      },
      [controls, onMouseLeave],
    );

    return (
      <div
        className={cn(className)}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        {...props}
      >
        <motion.svg
          animate={controls}
          fill="none"
          height={size}
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          transition={{ type: "spring", stiffness: 50, damping: 10 }}
          variants={{
            normal: {
              rotate: 0,
            },
            animate: {
              /* Round 15: ONE full turn per press. Ending at 360deg gives
                 a transform matrix identical to rest, so the instant stop
                 (duration 0) is pixel-identical — no twitch two seconds
                 after the press. The old park-at-180 spring-back was the
                 visible second animation. */
              rotate: [0, 180, 360],
              transition: {
                duration: 1.3,
                times: [0, 0.5, 1],
                ease: "easeInOut",
              },
            },
          }}
          viewBox="0 0 24 24"
          width={size}
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z" />
          <path d="M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
          <path d="M12 2v2" />
          <path d="M12 22v-2" />
          <path d="m17 20.66-1-1.73" />
          <path d="M11 10.27 7 3.34" />
          <path d="m20.66 17-1.73-1" />
          <path d="m3.34 7 1.73 1" />
          <path d="M14 12h8" />
          <path d="M2 12h2" />
          <path d="m20.66 7-1.73 1" />
          <path d="m3.34 17 1.73-1" />
          <path d="m17 3.34-1 1.73" />
          <path d="m11 13.73-4 6.93" />
        </motion.svg>
      </div>
    );
  },
);

CogIcon.displayName = "CogIcon";

export { CogIcon };

/*
 * Round 17 — owner-supplied reference implementations for the Contacts
 * and Security nav icons (lucide-animated style), replacing the round-16
 * pop/slam one-shots which read as "not correct":
 *   Contacts  = portrait draws itself (main arc strokes in, head pops
 *               in, side arcs stroke in after a short delay);
 *   Security  = shield outline strokes in with a slight scale/rotate
 *               settle, then the check mark draws itself.
 * Both run on hover on desktop and via the imperative handles on the
 * press-driven mobile nav. ONE deliberate adaptation to the reference:
 * the side arcs' "animate" keyframes end at their own "normal" opacity
 * (0.8 — the reference ended at 1), because the press window closes
 * with stopAnimation() two seconds after the tap; ending away from rest
 * would play a visible 1 -> 0.8 fade at that moment — the exact
 * "second animation" the owner rejected in round 15. The resting icon
 * is identical to the reference's own "normal" state, and both variants
 * END at rest so the stop is pixel-identical (silent).
 * Imports use framer-motion — same engine as the other icons in this
 * file; motion/react and framer-motion@12 expose the identical API.
 */

export interface UsersIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface UsersIconProps
  extends Omit<
    HTMLAttributes<HTMLDivElement>,
    | "color"
    | "onDrag"
    | "onDragStart"
    | "onDragEnd"
    | "onAnimationStart"
    | "onAnimationEnd"
    | "onAnimationIteration"
  > {
  size?: number;
  duration?: number;
  isAnimated?: boolean;
  color?: string;
}

const UsersIcon = forwardRef<UsersIconHandle, UsersIconProps>(
  (
    {
      onMouseEnter,
      onMouseLeave,
      className,
      size = 24,
      duration = 1,
      isAnimated = true,
      color,
      ...props
    },
    ref,
  ) => {
    const controls = useAnimation();
    const reduced = useReducedMotion();
    const isControlled = useRef(false);

    useImperativeHandle(ref, () => {
      isControlled.current = true;
      return {
        startAnimation: () =>
          reduced ? controls.start("normal") : controls.start("animate"),
        stopAnimation: () => controls.start("normal"),
      };
    });

    const handleEnter = useCallback(
      (e?: React.MouseEvent<HTMLDivElement>) => {
        if (!isAnimated || reduced) return;
        if (!isControlled.current) controls.start("animate");
        else onMouseEnter?.(e as any);
      },
      [controls, reduced, isAnimated, onMouseEnter],
    );

    const handleLeave = useCallback(
      (e?: React.MouseEvent<HTMLDivElement>) => {
        if (!isControlled.current) controls.start("normal");
        else onMouseLeave?.(e as any);
      },
      [controls, onMouseLeave],
    );

    const arcVariants: Variants = {
      normal: { strokeDashoffset: 0, opacity: 1 },
      animate: {
        strokeDashoffset: [50, 0],
        opacity: [0.3, 1],
        transition: {
          duration: 0.7 * duration,
          ease: "easeInOut" as const,
        },
      },
    };

    const headVariants: Variants = {
      normal: { scale: 1, opacity: 1 },
      animate: {
        scale: [0.6, 1.2, 1],
        opacity: [0, 1],
        transition: {
          duration: 0.6 * duration,
          ease: "easeOut" as const,
        },
      },
    };

    const sideArcVariants: Variants = {
      normal: { strokeDashoffset: 0, opacity: 0.8 },
      animate: {
        strokeDashoffset: [40, 0],
        /* Round 17 adaptation: keyframes end at the "normal" opacity so a
           completed animation is pixel-identical to rest — the 2s press
           window's stop can never play a visible return fade. */
        opacity: [0.2, 0.8],
        transition: {
          duration: 0.7 * duration,
          ease: "easeInOut" as const,
          delay: 0.3,
        },
      },
    };

    return (
      <LazyMotion features={domMin} strict>
        <m.div
          className={cn("inline-flex items-center justify-center", className)}
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
          {...props}
          style={{ color, ...props.style }}
        >
          <m.svg
            xmlns="http://www.w3.org/2000/svg"
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <m.path
              d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"
              strokeDasharray="50"
              strokeDashoffset="50"
              variants={arcVariants}
              initial="normal"
              animate={controls}
            />
            <m.path
              d="M16 3.128a4 4 0 0 1 0 7.744"
              strokeDasharray="40"
              strokeDashoffset="40"
              variants={sideArcVariants}
              initial="normal"
              animate={controls}
            />
            <m.path
              d="M22 21v-2a4 4 0 0 0-3-3.87"
              strokeDasharray="40"
              strokeDashoffset="40"
              variants={sideArcVariants}
              initial="normal"
              animate={controls}
            />
            <m.circle
              cx="9"
              cy="7"
              r="4"
              variants={headVariants}
              initial="normal"
              animate={controls}
            />
          </m.svg>
        </m.div>
      </LazyMotion>
    );
  },
);

UsersIcon.displayName = "UsersIcon";
export { UsersIcon };

export interface ShieldCheckIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface ShieldCheckIconProps
  extends Omit<
    HTMLAttributes<HTMLDivElement>,
    | "color"
    | "onDrag"
    | "onDragStart"
    | "onDragEnd"
    | "onAnimationStart"
    | "onAnimationEnd"
    | "onAnimationIteration"
  > {
  size?: number;
  duration?: number;
  isAnimated?: boolean;
  color?: string;
}

const ShieldCheckIcon = forwardRef<ShieldCheckIconHandle, ShieldCheckIconProps>(
  (
    {
      onMouseEnter,
      onMouseLeave,
      className,
      size = 24,
      duration = 1,
      isAnimated = true,
      color,
      ...props
    },
    ref,
  ) => {
    const shieldControls = useAnimation();
    const checkControls = useAnimation();
    const reduced = useReducedMotion();
    const isControlled = useRef(false);

    useImperativeHandle(ref, () => {
      isControlled.current = true;
      return {
        startAnimation: () => {
          if (reduced) {
            shieldControls.start("normal");
            checkControls.start("normal");
          } else {
            shieldControls.start("animate");
            checkControls.start("animate");
          }
        },
        stopAnimation: () => {
          shieldControls.start("normal");
          checkControls.start("normal");
        },
      };
    });

    const handleEnter = useCallback(
      (e?: React.MouseEvent<HTMLDivElement>) => {
        if (!isAnimated || reduced) return;
        if (!isControlled.current) {
          shieldControls.start("animate");
          checkControls.start("animate");
        } else onMouseEnter?.(e as any);
      },
      [shieldControls, checkControls, reduced, onMouseEnter, isAnimated],
    );

    const handleLeave = useCallback(
      (e?: React.MouseEvent<HTMLDivElement>) => {
        if (!isControlled.current) {
          shieldControls.start("normal");
          checkControls.start("normal");
        } else onMouseLeave?.(e as any);
      },
      [shieldControls, checkControls, onMouseLeave],
    );

    const shieldVariants: Variants = {
      normal: { strokeDashoffset: 0, scale: 1, rotate: 0 },
      animate: {
        strokeDashoffset: [300, 24, 0],
        scale: [1, 0.98, 1.04, 1],
        rotate: [0, -2, 1, 0],
        transition: {
          duration: 1.0 * duration,
          ease: [0.18, 0.85, 0.25, 1],
          times: [0, 0.35, 0.75, 1],
        },
      },
    };

    const checkVariants: Variants = {
      normal: { strokeDashoffset: 0, scale: 1, opacity: 1 },
      animate: {
        strokeDashoffset: [40, 0],
        scale: [1, 1.1, 0.98, 1],
        opacity: [0, 1, 1],
        transition: {
          duration: 1.3 * duration,
          ease: [0.22, 0.9, 0.28, 1],
          delay: 0.25,
          times: [0, 0.5, 1],
        },
      },
    };

    return (
      <LazyMotion features={domMin} strict>
        <m.div
          className={cn("inline-flex items-center justify-center", className)}
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
          {...props}
          style={{ color, ...props.style }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <m.path
              d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"
              initial="normal"
              animate={shieldControls}
              variants={shieldVariants}
              style={{ strokeDasharray: 300, transformOrigin: "12px 12px" }}
            />
            <m.path
              d="m9 12 2 2 4-4"
              initial="normal"
              animate={checkControls}
              variants={checkVariants}
              style={{ strokeDasharray: 40, strokeLinecap: "round" }}
            />
          </svg>
        </m.div>
      </LazyMotion>
    );
  },
);

ShieldCheckIcon.displayName = "ShieldCheckIcon";
export { ShieldCheckIcon };
