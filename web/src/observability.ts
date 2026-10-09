import * as Sentry from '@sentry/react'
import { onCLS, onINP, onLCP, type Metric } from 'web-vitals'

function recordVital(metric: Metric) {
  Sentry.addBreadcrumb({
    category: 'web-vitals',
    message: metric.name,
    level: 'info',
    data: { name: metric.name, value: Math.round(metric.value), rating: metric.rating },
  })
}

/** Enable privacy-filtered error capture and vital breadcrumbs only when configured. */
export function initializeObservability() {
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (!dsn) return

  Sentry.init({
    dsn,
    tracesSampleRate: 0,
    beforeSend(event) {
      event.user = undefined
      event.request = undefined
      event.extra = undefined
      event.transaction = undefined
      event.tags = undefined
      event.breadcrumbs = event.breadcrumbs?.filter((breadcrumb) => breadcrumb.category === 'web-vitals')
      if (event.message) event.message = 'Console runtime error'
      if (event.exception?.values) {
        event.exception.values = event.exception.values.map((exception) => ({
          ...exception,
          value: 'Console runtime error',
        }))
      }
      return event
    },
  })

  onCLS(recordVital)
  onINP(recordVital)
  onLCP(recordVital)
}
