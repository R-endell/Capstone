// src/components/ui/DraggableSheet.tsx
//
// A bottom sheet with two independent gestures that cooperate:
//   1. DRAG   – swipe the sheet (handle, header or body) up / down. It follows the finger and snaps
//               to "collapsed" or "expanded".
//   2. SCROLL – the content inside has its own vertical scrolling once the sheet is expanded.
//
// How they are kept apart (no ScrollView position is used to move the sheet):
//   • Collapsed: the inner ScrollView is disabled, so the sheet's PanResponder owns every vertical drag.
//   • Expanded and content scrolled down: the PanResponder steps aside, the native ScrollView scrolls.
//   • Expanded and content at the very top: the inner ScrollView is disabled again. The PanResponder
//     reads the drag: pulling DOWN lowers the sheet, pushing UP scrolls the content (then the native
//     ScrollView takes over for the next touch).
//
// Only react-native core APIs are used (Animated + PanResponder), so no new dependency is needed.
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Animated, PanResponder, ScrollView, StyleProp, TouchableOpacity, View, ViewStyle } from 'react-native';

export type DraggableSheetHandle = { open: () => void; close: () => void; toggle: () => void };

type Props = {
  /** Shared translateY value: `collapsedY` = collapsed, `0` = fully expanded. Create it in the parent. */
  y: Animated.Value;
  /** How far the sheet is pushed down when collapsed (sheet height - visible height). */
  collapsedY: number;
  /** Total (expanded) height of the sheet. Optional when `style` already sets a height. */
  height?: number;
  /** Space under the last item of the scrolling content (use the bottom safe-area inset + margin). */
  contentPaddingBottom?: number;
  style?: StyleProp<ViewStyle>;
  handleHitAreaStyle?: StyleProp<ViewStyle>;
  handleStyle?: StyleProp<ViewStyle>;
  /** Fixed area under the handle that does not scroll (it is also a drag area). */
  header?: React.ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** Height of the scrolling content (includes `contentPaddingBottom`). Lets the parent shrink the sheet to fit. */
  onContentHeight?: (h: number) => void;
  /** Called once each time the sheet settles open / closed. */
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
};

const DEFAULT_HIT_AREA: ViewStyle = { alignItems: 'center', justifyContent: 'center', paddingVertical: 10 };
const DEFAULT_HANDLE: ViewStyle = { width: 40, height: 4, borderRadius: 2, backgroundColor: '#CBD5E1' };

const DraggableSheet = forwardRef<DraggableSheetHandle, Props>(function DraggableSheet(
  {
    y, collapsedY, height, contentPaddingBottom = 24, style, handleHitAreaStyle, handleStyle,
    header, contentContainerStyle, onContentHeight, onOpenChange, children,
  },
  ref,
) {
  const scrollRef = useRef<ScrollView>(null);

  const openRef = useRef(false);          // settled / target state
  const reported = useRef(false);         // last value sent to onOpenChange
  const curY = useRef(collapsedY);        // live translateY
  const startY = useRef(collapsedY);      // translateY when the current drag began
  const lastRaw = useRef(collapsedY);     // startY + dy of the current drag (< 0 means "content is being scrolled")
  const scrollYRef = useRef(0);
  const contentH = useRef(0);
  const viewH = useRef(0);
  const collapsedRef = useRef(collapsedY);
  collapsedRef.current = collapsedY;
  const cbRef = useRef(onOpenChange);
  cbRef.current = onOpenChange;
  const heightCbRef = useRef(onContentHeight);
  heightCbRef.current = onContentHeight;

  const scrollableRef = useRef(false);
  const [scrollable, setScrollableState] = useState(false);
  const setScrollable = useCallback((v: boolean) => {
    if (scrollableRef.current === v) return;
    scrollableRef.current = v;
    setScrollableState(v);
  }, []);

  useEffect(() => {
    const id = y.addListener(({ value }) => { curY.current = value; });
    return () => y.removeListener(id);
  }, [y]);

  // The parent may change the collapsed position (e.g. the sheet was resized to fit its content).
  useEffect(() => {
    collapsedRef.current = collapsedY;
    if (!openRef.current) y.setValue(collapsedY);
  }, [collapsedY, y]);

  const snap = useCallback((open: boolean) => {
    openRef.current = open;
    Animated.spring(y, {
      toValue: open ? 0 : collapsedRef.current,
      useNativeDriver: true,
      bounciness: 0,
      speed: 16,
    }).start(({ finished }) => {
      if (finished && !open) {
        scrollRef.current?.scrollTo({ y: 0, animated: false });
        scrollYRef.current = 0;
      }
    });
    if (!open) setScrollable(false);
    if (reported.current !== open) {
      reported.current = open;
      cbRef.current?.(open);
    }
  }, [y, setScrollable]);

  useImperativeHandle(ref, () => ({
    open: () => snap(true),
    close: () => { if (openRef.current) snap(false); },
    toggle: () => snap(!openRef.current),
  }), [snap]);

  const finish = useCallback((vy: number) => {
    const raw = lastRaw.current;
    if (raw < 0) { snap(true); return; }                 // the user was scrolling the content
    const pos = Math.min(collapsedRef.current, raw);
    snap(vy < -0.4 ? true : vy > 0.4 ? false : pos < collapsedRef.current / 2);
  }, [snap]);

  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_e, g) => {
      if (Math.abs(g.dy) < 6 || Math.abs(g.dx) > Math.abs(g.dy)) return false;
      // content is scrolled down -> let the native ScrollView handle it
      if (openRef.current && scrollYRef.current > 1) return false;
      return true;
    },
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => {
      y.stopAnimation();
      startY.current = curY.current;
      lastRaw.current = startY.current;
    },
    onPanResponderMove: (_e, g) => {
      const raw = startY.current + g.dy;
      lastRaw.current = raw;
      y.setValue(Math.min(collapsedRef.current, Math.max(0, raw)));
      if (raw < 0) {
        // sheet is fully up and the finger keeps going up: scroll the content by hand
        const max = Math.max(0, contentH.current - viewH.current);
        const off = Math.min(max, -raw);
        scrollRef.current?.scrollTo({ y: off, animated: false });
        scrollYRef.current = off;
        if (off > 2) setScrollable(true);
      }
    },
    onPanResponderRelease: (_e, g) => finish(g.vy),
    onPanResponderTerminate: () => finish(0),
  })).current;

  return (
    <Animated.View
      {...pan.panHandlers}
      style={[style, height != null && { height }, { transform: [{ translateY: y }] }]}
    >
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={() => snap(!openRef.current)}
        style={[DEFAULT_HIT_AREA, handleHitAreaStyle]}
        hitSlop={{ top: 8, bottom: 8 }}
      >
        <View style={[DEFAULT_HANDLE, handleStyle]} />
      </TouchableOpacity>

      {header}

      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        scrollEnabled={scrollable}
        showsVerticalScrollIndicator={false}
        bounces={false}
        overScrollMode="never"
        nestedScrollEnabled
        scrollEventThrottle={16}
        onScroll={(e) => {
          const yy = e.nativeEvent.contentOffset.y;
          scrollYRef.current = yy;
          if (yy <= 1) setScrollable(false);       // back at the top: the sheet gesture owns the next drag
        }}
        onLayout={(e) => { viewH.current = e.nativeEvent.layout.height; }}
        onContentSizeChange={(_w, h) => { contentH.current = h; heightCbRef.current?.(h); }}
        contentContainerStyle={[{ paddingBottom: contentPaddingBottom }, contentContainerStyle]}
      >
        {children}
      </ScrollView>
    </Animated.View>
  );
});

export default DraggableSheet;