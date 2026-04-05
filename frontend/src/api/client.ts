import axios from 'axios'

/** Base Axios instance — all API calls go through this. */
export const apiClient = axios.create({
  baseURL: '/api',
  timeout: 60_000,
})
