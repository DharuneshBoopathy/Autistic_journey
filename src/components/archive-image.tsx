'use client';

import type { ImgHTMLAttributes } from 'react';

/**
 * An image served from the archive.
 *
 * The right-click block and the drag block are **deterrents, not protection**.
 * Anyone who can see a photo can screenshot it, and no browser API prevents that;
 * SECURITY.md says so plainly rather than claiming otherwise. What they do achieve
 * is making "Save image as…" a deliberate act rather than a reflex, which is the
 * honest extent of what the client can contribute.
 *
 * The real control is on the server: these URLs re-check authorization on every
 * request and are never signed, public, or cacheable by a shared cache.
 */
export function ArchiveImage(props: ImgHTMLAttributes<HTMLImageElement>) {
  return (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img
      {...props}
      draggable={false}
      onContextMenu={(event) => {
        event.preventDefault();
        props.onContextMenu?.(event);
      }}
    />
  );
}
