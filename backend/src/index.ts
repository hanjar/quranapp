import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { quranRoutes } from './routes/quran'
import { searchRoutes } from './routes/search'
import { bookmarkRoutes } from './routes/bookmarks'
import { noteRoutes } from './routes/notes'
import { authRoutes } from './routes/auth'

type Bindings = {
  QURAN_CACHE: KVNamespace
  DB: D1Database
  JWT_SECRET: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  FRONTEND_URL: string
}

const app = new Hono<{ Bindings: Bindings }>();

// CORS middleware
app.use('*', cors({
  origin: '*', // Allow all origins for initial deployment (restrict to your domain later)
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
}));

// Routes
app.route('/api/auth', authRoutes)
app.route('/api/quran', quranRoutes)
app.route('/api/search', searchRoutes)
app.route('/api/bookmarks', bookmarkRoutes)
app.route('/api/notes', noteRoutes)

// Health check
app.get('/', (c) => c.json({ status: 'ok', service: 'quran-api' }));

export default app;
