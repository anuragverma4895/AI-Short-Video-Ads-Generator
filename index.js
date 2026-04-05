// Fallback entry for Render default `node index.js`
import("./server/dist/server.js").catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
