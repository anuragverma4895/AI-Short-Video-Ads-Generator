import axios from "axios";

const configuredBaseURL = import.meta.env.VITE_BASEURL?.trim() || "";
const isBrowser = typeof window !== "undefined";
const isLocalApp =
  isBrowser &&
  ["localhost", "127.0.0.1"].includes(window.location.hostname);
const isLocalApiURL = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(
  configuredBaseURL
);

const api = axios.create({
  baseURL: isLocalApiURL && !isLocalApp ? "" : configuredBaseURL,
});

export default api;
