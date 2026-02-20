import { Context, Next } from 'hono'
import { verify } from 'hono/jwt'

export const authMiddleware = async (c: Context, next: Next) => {
    const authHeader = c.req.header('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.log('[auth] Missing or malformed Authorization header:', authHeader)
        return c.json({ error: 'Unauthorized' }, 401)
    }

    const token = authHeader.split(' ')[1]
    try {
        const secret = c.env.JWT_SECRET || 'dev-secret-key-change-in-prod'
        console.log('[auth] Verifying token with secret length:', secret?.length, 'token prefix:', token?.substring(0, 20))
        const payload = await verify(token, secret, 'HS256')
        console.log('[auth] Token verified OK, user:', payload)
        c.set('user', payload)
        await next()
    } catch (err: any) {
        console.error('[auth] Token verification failed:', err.message, 'token prefix:', token?.substring(0, 20))
        return c.json({ error: 'Invalid token', details: err.message }, 401)
    }
}
