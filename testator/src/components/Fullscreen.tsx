import React, { useEffect } from 'react';
import { Box } from 'ink';

/**
 * Switches the terminal to the alternate screen buffer and hides the
 * cursor for as long as this is mounted, restoring both on unmount —
 * `Shell` wraps the whole app in this so testator behaves like a full
 * TUI (e.g. vim) instead of scrolling the normal terminal history.
 */
export function Fullscreen({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    process.stdout.write('\x1b[?1049h');
    process.stdout.write('\x1b[?25l');
    return () => {
      process.stdout.write('\x1b[?25h');
      process.stdout.write('\x1b[?1049l');
    };
  }, []);

  return (
    // minHeight, not height: a fixed height forces Yoga to shrink content
    // that's taller than the terminal to fit, and that shrink pass doesn't
    // degrade gracefully — it silently drops/overlaps whichever row loses
    // the rounding, corrupting the display rather than just scrolling. A
    // short screen still gets the full-height pinned layout; a tall one
    // (a 13+ element list) now overflows into normal terminal scrollback
    // instead of rendering garbled.
    <Box flexDirection="column" width={process.stdout.columns || 80} minHeight={(process.stdout.rows || 24) - 1}>
      {children}
    </Box>
  );
}
