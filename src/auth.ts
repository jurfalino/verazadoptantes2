import NextAuth from "next-auth"
import Google from "next-auth/providers/google"

export const { handlers, signIn, signOut, auth } = NextAuth({
    providers: [Google],
    trustHost: true, // Required for development with localhost
    callbacks: {
        authorized: async ({ auth }) => {
            // Logged in users are authenticated, otherwise false
            return !!auth
        },
    },
})
