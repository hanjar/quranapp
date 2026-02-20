import { Context, Next } from 'hono'
import { verify } from 'hono/jwt'

export const authMiddleware = async (c: Context, next: Next) => {
    const authHeader = c.req.header('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return c.json({ error: 'Unauthorized' }, 401)
    }

    const token = authHeader.split(' ')[1]
    try {
        const secret = c.env.JWT_SECRET || 'dev-secret-key-change-in-prod'
        const payload = await verify(token, secret, 'HS256')
        c.set('user', payload)
        await next()
    } catch (err: any) {
        return c.json({ error: 'Invalid token', details: err.message }, 401)
    }
}
