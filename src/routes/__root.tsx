import { HeadContent, createRootRoute } from '@tanstack/react-router'

import appCss from '../styles.css?url'
import * as React from "react";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'Far From Perfect',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
    ],
  }),

  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent /><title>Far From Perfect</title>
      </head>
      <body>
        {children}
      </body>
    </html>
  )
}
