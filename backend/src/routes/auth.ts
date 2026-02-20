
import { Hono } from 'hono'
import { sign } from 'hono/jwt'
import { compare, hash } from 'bcryptjs'

type Bindings = {
    DB: D1Database
    JWT_SECRET: string
    GOOGLE_CLIENT_ID: string
    GOOGLE_CLIENT_SECRET: string
    FRONTEND_URL: string
}

const authRoutes = new Hono<{ Bindings: Bindings, Variables: { user: any } }>()

// Helper to generate JWT
const generateToken = async (user: any, secret: string) => {
    // payload must be plain object
    return await sign({
        id: user.id,
        email: user.email,
        name: user.name,
        picture: user.picture,
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 // 7 days
    }, secret, 'HS256')
}

// Google Login
authRoutes.get('/google/login', (c) => {
    const redirectUri = `${new URL(c.req.url).origin}/api/auth/google/callback`
    const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${c.env.GOOGLE_CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=email%20profile`
    return c.redirect(googleAuthUrl)
})

authRoutes.get('/google/callback', async (c) => {
    const code = c.req.query('code')
    if (!code) return c.json({ error: 'No code provided' }, 400)

    try {
        const redirectUri = `${new URL(c.req.url).origin}/api/auth/google/callback`

        // Exchange code for token
        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code,
                client_id: c.env.GOOGLE_CLIENT_ID,
                client_secret: c.env.GOOGLE_CLIENT_SECRET,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code',
            }),
        })

        const tokenData: any = await tokenResponse.json()
        if (tokenData.error) throw new Error(tokenData.error_description)

        // Get user info
        const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` },
        })
        const userData: any = await userResponse.json()

        // Upsert user in D1
        const existingUser: any = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(userData.email).first()

        let userId = existingUser?.id
        if (!existingUser) {
            userId = crypto.randomUUID()
            await c.env.DB.prepare(
                'INSERT INTO users (id, email, google_id, name, picture, created_at) VALUES (?, ?, ?, ?, ?, datetime("now"))'
            ).bind(userId, userData.email, userData.id, userData.name, userData.picture).run()
        } else {
            // Update google_id if missing (linking accounts)
            if (!existingUser.google_id) {
                await c.env.DB.prepare('UPDATE users SET google_id = ?, picture = ? WHERE id = ?')
                    .bind(userData.id, userData.picture, userId).run()
            }
        }

        // Generate JWT
        const token = await generateToken({ id: userId, email: userData.email, name: userData.name, picture: userData.picture }, c.env.JWT_SECRET)

        // Redirect to frontend with token
        return c.redirect(`${c.env.FRONTEND_URL}/auth/callback?token=${token}`)

    } catch (error: any) {
        return c.json({ error: 'Authentication failed', details: error.message }, 500)
    }
})

// Email/Password Registration
authRoutes.post('/register', async (c) => {
    const { email, password, name } = await c.req.json()

    if (!email || !password) return c.json({ error: 'Email and password required' }, 400)

    const existingUser = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first()
    if (existingUser) return c.json({ error: 'User already exists' }, 409)

    const hashedPassword = await hash(password, 10)
    const userId = crypto.randomUUID()

    await c.env.DB.prepare(
        'INSERT INTO users (id, email, password_hash, name, created_at) VALUES (?, ?, ?, ?, datetime("now"))'
    ).bind(userId, email, hashedPassword, name || email.split('@')[0]).run()

    const token = await generateToken({ id: userId, email, name }, c.env.JWT_SECRET)

    return c.json({ token, user: { id: userId, email, name } })
})

// Email/Password Login
authRoutes.post('/login', async (c) => {
    const { email, password } = await c.req.json()

    if (!email || !password) return c.json({ error: 'Email and password required' }, 400)

    const user = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first() as any
    if (!user || !user.password_hash) return c.json({ error: 'Invalid credentials' }, 401)

    const validPassword = await compare(password, user.password_hash)
    if (!validPassword) return c.json({ error: 'Invalid credentials' }, 401)

    const token = await generateToken(user, c.env.JWT_SECRET)

    return c.json({ token, user: { id: user.id, email: user.email, name: user.name, picture: user.picture } })
})

// Get Current User
authRoutes.get('/me', async (c) => {
    const user = c.get('user') as any // Set by middleware
    if (!user) return c.json({ error: 'Unauthorized' }, 401)

    const dbUser = await c.env.DB.prepare('SELECT id, email, name, picture FROM users WHERE id = ?').bind(user.id).first()
    return c.json(dbUser)
})

export { authRoutes }
