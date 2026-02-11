import NextAuth from "next-auth"
import { authConfig } from "./auth.config"
import { REQUIRED_SESSION_VERSION } from "./auth.config";

export const { handlers, signIn, signOut, auth } = NextAuth({
    ...authConfig,
    callbacks: {
        ...authConfig.callbacks,
        jwt: async ({ token, trigger }) => {
            // Stamp new tokens with the current required version on sign-in
            if (trigger === 'signIn') {
                token.sessionVersion = REQUIRED_SESSION_VERSION;
            }
            return token;
        },
        session: async ({ session, token }) => {
            // Expose sessionVersion so the authorized middleware callback can check it
            (session as unknown as { sessionVersion: number }).sessionVersion = (token.sessionVersion as number) || 0;
            return session;
        },
    },
    session: {
        strategy: "jwt",
        maxAge: 315360000, // 10 years (effectively "never" expire)
    },
})
