import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

serve((req) => {
  const url = new URL(req.url)
  const target = url.searchParams.get('to') || 'payment-success'
  const deepLink = `packnship://${target}`

  return new Response(null, {
    status: 302,
    headers: { Location: deepLink },
  })
})