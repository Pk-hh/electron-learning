import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import fs from 'fs'
import path from 'path'

// Vite plugin to automatically list all videos in the public/videos folder
function listVideosPlugin(): Plugin {
  return {
    name: 'vite-plugin-list-videos',
    configureServer(server) {
      server.middlewares.use('/api/folder-videos', (_req, res) => {
        try {
          const videosDir = path.resolve(__dirname, 'public/videos')
          if (!fs.existsSync(videosDir)) {
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify([]))
            return
          }
          const files = fs.readdirSync(videosDir)
          const videoExtensions = ['.mp4', '.webm', '.ogg', '.mov', '.mkv']
          const videoFiles = files
            .filter(file => videoExtensions.includes(path.extname(file).toLowerCase()))
            .map(file => ({
              name: file,
              url: `/videos/${encodeURIComponent(file)}`,
              source: 'public_folder',
            }))

          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(videoFiles))
        } catch (err) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: String(err) }))
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), listVideosPlugin()],
})
