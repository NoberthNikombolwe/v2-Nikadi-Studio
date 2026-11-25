/**
 * R2 storage client — mirrors the Supabase storage API surface used in App.jsx
 * so the calling code is a simple import swap.
 *
 * Reads: served from the R2 public URL (VITE_R2_PUBLIC_URL) when configured,
 *        falling back to /files/{bucket}/{path} served by the Worker.
 * Writes: proxied through the Worker's /api/r2/* endpoints, which require
 *         CF Access authentication.
 */

const R2_PUBLIC = (import.meta.env.VITE_R2_PUBLIC_URL || "").replace(/\/$/, "");

function publicUrl(bucket, path) {
  return R2_PUBLIC
    ? `${R2_PUBLIC}/${bucket}/${path}`
    : `/files/${bucket}/${path}`;
}

function r2Bucket(name) {
  return {
    async upload(path, blob, opts = {}) {
      try {
        const r = await fetch(`/api/r2/${name}/${path}`, {
          method: "PUT",
          body: blob,
          headers: { "Content-Type": opts.contentType || blob.type || "application/octet-stream" },
        });
        return r.ok ? { error: null } : { error: { message: `Upload failed (${r.status})` } };
      } catch (e) {
        return { error: { message: e.message } };
      }
    },

    getPublicUrl(path) {
      return { data: { publicUrl: publicUrl(name, path) } };
    },

    async remove(paths) {
      try {
        await fetch(`/api/r2/${name}/delete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paths }),
        });
      } catch { /* fire and forget */ }
      return { error: null };
    },

    async list(prefix = "") {
      try {
        const r = await fetch(`/api/r2/${name}/list?prefix=${encodeURIComponent(prefix)}`);
        if (!r.ok) return { data: null, error: { message: "List failed" } };
        const { objects = [] } = await r.json();
        return { data: objects, error: null };
      } catch (e) {
        return { data: null, error: { message: e.message } };
      }
    },
  };
}

export const r2Storage = { from: r2Bucket };
