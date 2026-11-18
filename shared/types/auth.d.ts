// What the session stores about the signed-in GitHub user. No tokens.
declare module '#auth-utils' {
  interface User {
    login: string
    name: string
    avatarUrl: string
  }
}

export {}
