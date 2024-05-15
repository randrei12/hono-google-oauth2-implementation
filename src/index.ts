import { Hono } from 'hono';
import { env } from "hono/adapter";
import { HTTPException } from "hono/http-exception";
import { getCookie, setCookie } from "hono/cookie";
import { sign, unsign } from "cookie-signature";
import { User, sessionsCollection, usersCollection } from './lib/db';
import { ObjectId } from 'mongodb';

const app = new Hono();

app.get('/', async c => {
    const cookie = getCookie(c, "token");

    if (cookie && typeof cookie === "string") {
        const { COOKIE_SECRET } = env(c) as Record<string, string>;

        const id = unsign(cookie, COOKIE_SECRET);
        if (id) {
            const _id = ObjectId.createFromHexString(id);

            const session = await sessionsCollection.findOne({ _id });
            if (session) {
                const user = await usersCollection.findOne({ _id: session.userId })!; // the user is guaranteed to be found

                return c.json(user);
            }
        }
    }

    const authorizationUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authorizationUrl.searchParams.set('client_id', env(c).GOOGLE_CLIENT_ID as string);
    authorizationUrl.searchParams.set('redirect_uri', "http://localhost:3000/google/callback");
    authorizationUrl.searchParams.set('prompt', 'consent');
    authorizationUrl.searchParams.set('response_type', 'code');
    authorizationUrl.searchParams.set('scope', 'openid email profile');
    authorizationUrl.searchParams.set('access_type', 'offline');

    return new Response(null, {
        status: 302,
        headers: {
            Location: authorizationUrl.toString(),
        },
    });
});

app.get("/google/callback", async c => {
    const code = c.req.query("code");
    if (!code) {
        throw new HTTPException(400);
    }

    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, COOKIE_SECRET } = env(c) as Record<string, string>;
    try {
        const tokenEndpoint = new URL('https://accounts.google.com/o/oauth2/token')
        tokenEndpoint.searchParams.set('code', code)
        tokenEndpoint.searchParams.set('grant_type', 'authorization_code')
        // Get the Google Client ID from the env
        tokenEndpoint.searchParams.set('client_id', GOOGLE_CLIENT_ID)
        // Get the Google Secret from the env
        tokenEndpoint.searchParams.set('client_secret', GOOGLE_CLIENT_SECRET)
        // Add your own callback URL
        tokenEndpoint.searchParams.set('redirect_uri', "http://localhost:3000/google/callback")
        const tokenResponse = await fetch(tokenEndpoint.origin + tokenEndpoint.pathname, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: tokenEndpoint.searchParams.toString(),
        });
        const tokenData = await tokenResponse.json();

        const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: {
                Authorization: `Bearer ${tokenData.access_token}`,
            },
        });
        const userInfo = await userInfoResponse.json() as User;

        let cookie;
        const user = await usersCollection.findOne({ email: userInfo.email }, { projection: { _id: 1 } });
        if (!user) {
            const { insertedId } = await usersCollection.insertOne({
                ...userInfo,
                created: new Date()
            });
            cookie = insertedId;
        }

        const { insertedId } = await sessionsCollection.insertOne({ userId: cookie || user!._id, created: new Date() });

        setCookie(c, "token", sign(insertedId.toHexString(), COOKIE_SECRET), { httpOnly: true, sameSite: "Lax" });

        return c.redirect("/");
    } catch (error) {
        console.error('Error fetching user info:', error);
        throw new HTTPException(500);
    }
});

export default {
    port: 3000,
    fetch: app.fetch,
};