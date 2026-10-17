import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import fs from 'fs'
import path from 'path'

// Vite plugin to list and stream videos reliably
function listVideosPlugin(): Plugin {
  return {
    name: 'vite-plugin-list-videos',
    configureServer(server) {
      // 1. Video file streamer with HTTP 206 Range support
      server.middlewares.use((req, res, next) => {
        if (req.url && req.url.startsWith('/videos/')) {
          try {
            const videosDir = path.resolve(process.cwd(), 'public/videos')
            if (!fs.existsSync(videosDir)) return next()

            const urlPath = req.url.split('?')[0]
            let filename = decodeURIComponent(urlPath.replace('/videos/', ''))

            let filePath = path.join(videosDir, filename)

            // If not found, fuzzy match against files in public/videos
            if (!fs.existsSync(filePath)) {
              const allFiles = fs.readdirSync(videosDir)
              const matched = allFiles.find(
                f =>
                  f.toLowerCase() === filename.toLowerCase() ||
                  encodeURI(f) === filename ||
                  encodeURIComponent(f) === filename ||
                  f.replace(/[^a-zA-Z0-9]/g, '') === filename.replace(/[^a-zA-Z0-9]/g, '')
              )
              if (matched) {
                filePath = path.join(videosDir, matched)
              }
            }

            if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
              const stat = fs.statSync(filePath)
              const fileSize = stat.size
              const range = req.headers.range

              res.setHeader('Content-Type', 'video/mp4')
              res.setHeader('Accept-Ranges', 'bytes')
              res.setHeader('Access-Control-Allow-Origin', '*')

              if (range) {
                const parts = range.replace(/bytes=/, '').split('-')
                const start = parseInt(parts[0], 10)
                const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1
                const chunkSize = end - start + 1
                const stream = fs.createReadStream(filePath, { start, end })

                res.writeHead(206, {
                  'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                  'Accept-Ranges': 'bytes',
                  'Content-Length': chunkSize,
                  'Content-Type': 'video/mp4',
                })
                stream.pipe(res)
                return
              } else {
                res.writeHead(200, {
                  'Content-Length': fileSize,
                  'Content-Type': 'video/mp4',
                })
                fs.createReadStream(filePath).pipe(res)
                return
              }
            }
          } catch (err) {
            console.warn('Video streamer middleware warning:', err)
          }
        }
        next()
      })

      // 2. Folder video listing endpoint
      server.middlewares.use('/api/folder-videos', (_req, res) => {
        try {
          const videosDir = path.resolve(process.cwd(), 'public/videos')
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
              url: `/videos/${encodeURI(file)}`,
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
  base: './',
  plugins: [react(), listVideosPlugin()],
})
