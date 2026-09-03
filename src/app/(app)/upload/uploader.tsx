'use client';

import { useCallback, useRef, useState } from 'react';
import { Masthead, VISIBILITY_LABEL } from '@/components/ui';
import styles from '@/components/gallery.module.css';
import ui from '@/components/ui.module.css';

type Status = 'pending' | 'uploading' | 'done' | 'duplicate' | 'failed';
type Item = { id: string; file: File; status: Status; error?: string };

/**
 * How many uploads run at once.
 *
 * One at a time makes a 500-photo batch painfully slow; too many saturate a phone's
 * uplink and cause timeouts. Four keeps the connection busy while leaving each
 * request enough bandwidth to finish.
 */
const CONCURRENCY = 4;

let nextId = 0;

export function Uploader() {
  const [items, setItems] = useState<Item[]>([]);
  const [visibility, setVisibility] = useState('private');
  const [dragging, setDragging] = useState(false);
  const [running, setRunning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((files: FileList | File[]) => {
    const accepted = Array.from(files).filter((f) => f.type.startsWith('image/'));
    setItems((current) => [
      ...current,
      ...accepted.map((file) => ({ id: `f${nextId++}`, file, status: 'pending' as Status })),
    ]);
  }, []);

  const update = (id: string, patch: Partial<Item>) =>
    setItems((current) => current.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  const uploadOne = useCallback(
    async (item: Item) => {
      update(item.id, { status: 'uploading' });

      const form = new FormData();
      form.append('file', item.file);
      form.append('visibility', visibility);

      try {
        const response = await fetch('/api/upload', { method: 'POST', body: form });
        const body = await response.json().catch(() => ({}));

        if (!response.ok) {
          update(item.id, { status: 'failed', error: body.error ?? `Failed (${response.status})` });
          return;
        }
        update(item.id, { status: body.duplicate ? 'duplicate' : 'done' });
      } catch {
        update(item.id, { status: 'failed', error: 'Network error' });
      }
    },
    [visibility],
  );

  /**
   * Drain the queue with a fixed number of workers.
   *
   * Only `pending` and `failed` items are picked up, so pressing the button again
   * retries exactly what did not succeed rather than re-uploading the whole batch.
   */
  const start = useCallback(async () => {
    setRunning(true);
    try {
      const queue = items.filter((i) => i.status === 'pending' || i.status === 'failed');
      let cursor = 0;

      const worker = async () => {
        for (;;) {
          const item = queue[cursor++];
          if (!item) return;
          await uploadOne(item);
        }
      };

      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    } finally {
      setRunning(false);
    }
  }, [items, uploadOne]);

  const counts = items.reduce<Record<Status, number>>(
    (acc, item) => ({ ...acc, [item.status]: (acc[item.status] ?? 0) + 1 }),
    {} as Record<Status, number>,
  );
  const outstanding = (counts.pending ?? 0) + (counts.failed ?? 0);

  return (
    <div className={ui.pageNarrow}>
      <Masthead
        eyebrow="Add to the archive"
        title="Upload"
        lede="Photos are processed in the background and appear on the timeline once their previews are ready."
      />

      <label className={ui.field}>
        <span className={ui.label}>Who can see these</span>
        <select
          className={ui.select}
          value={visibility}
          onChange={(event) => setVisibility(event.target.value)}
          aria-label="Who can see these"
        >
          <option value="private">{VISIBILITY_LABEL.private}</option>
          <option value="batch">{VISIBILITY_LABEL.batch}</option>
        </select>
        <span className={ui.hint}>
          Applies to everything in this batch, and defaults to private. Sharing with specific groups
          or people is set per photo afterwards, from the photo itself.
        </span>
      </label>

      <div
        className={`${styles.drop} ${dragging ? styles.dropActive : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          addFiles(event.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
      >
        <p className={styles.dropTitle}>Drop photos here</p>
        <p style={{ fontSize: 'var(--text-sm)' }}>or click to choose them</p>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(event) => {
            if (event.target.files) addFiles(event.target.files);
            event.target.value = '';
          }}
        />
      </div>

      {items.length > 0 && (
        <>
          <div className={styles.queue}>
            {items.map((item) => (
              <div key={item.id} className={styles.queueRow}>
                <span className={styles.queueName}>{item.file.name}</span>
                <span className={`${styles.queueStatus} ${statusClass(item.status)}`}>
                  {statusLabel(item)}
                </span>
              </div>
            ))}
          </div>

          <p style={{ margin: 'var(--s4) 0', fontSize: 'var(--text-sm)', color: 'var(--ink-muted)' }}>
            {counts.done ?? 0} uploaded
            {counts.duplicate ? `, ${counts.duplicate} already in the archive` : ''}
            {counts.failed ? `, ${counts.failed} failed` : ''}
            {outstanding ? `, ${outstanding} to go` : ''}
          </p>

          <button
            className={ui.button}
            onClick={() => void start()}
            disabled={running || outstanding === 0}
          >
            {running
              ? 'Uploading…'
              : counts.failed
                ? `Retry ${counts.failed} failed`
                : `Upload ${outstanding} photo${outstanding === 1 ? '' : 's'}`}
          </button>
        </>
      )}
    </div>
  );
}

function statusClass(status: Status): string {
  if (status === 'done' || status === 'duplicate') return styles.statusOk!;
  if (status === 'failed') return styles.statusFail!;
  if (status === 'uploading') return styles.statusBusy!;
  return styles.statusIdle!;
}

function statusLabel(item: Item): string {
  switch (item.status) {
    case 'pending':
      return 'Waiting';
    case 'uploading':
      return 'Uploading…';
    case 'done':
      return 'Uploaded';
    case 'duplicate':
      return 'Already here';
    case 'failed':
      return item.error ?? 'Failed';
  }
}
