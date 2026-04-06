import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_BASEURL || (import.meta.env.PROD ? window.location.origin + "/api" : "/api"),
});



export default api;