import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Filler,
  type ChartOptions,
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import { useTheme } from '../../context/ThemeContext'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler)

type Row = { key: string; reservations: number; collected: number }

// Colours per surface: the line is categorical slot 1 (validated for both modes); text and grid
// use neutral ink so they stay readable on screen and on white paper.
const INK = {
  dark: { line: '#3987e5', text: '#c3c2b7', grid: 'rgba(255,255,255,0.08)', surface: '#1a1a19' },
  light: { line: '#2a78d6', text: '#52514e', grid: 'rgba(0,0,0,0.08)', surface: '#ffffff' },
}

function addDays(iso: string, days: number) {
  const date = new Date(`${iso}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function addMonths(month: string, months: number) {
  const date = new Date(`${month}-01T00:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() + months)
  return date.toISOString().slice(0, 7)
}

// Every day (or month) in the range, so quiet days show as zero instead of being skipped.
export function fillTimeline(rows: Row[], start: string, end: string, byMonth: boolean): Row[] {
  const byKey = new Map(rows.map((row) => [row.key, row]))
  const keys: string[] = []
  if (byMonth) {
    for (let m = start.slice(0, 7); m <= end.slice(0, 7) && keys.length < 120; m = addMonths(m, 1)) keys.push(m)
  } else {
    for (let d = start; d <= end && keys.length < 400; d = addDays(d, 1)) keys.push(d)
  }
  return keys.map((key) => byKey.get(key) || { key, reservations: 0, collected: 0 })
}

function tickLabel(key: string) {
  const monthOnly = key.length === 7
  const date = new Date(`${monthOnly ? `${key}-01` : key}T12:00:00Z`)
  return date.toLocaleDateString('en-PH', monthOnly ? { month: 'short', year: 'numeric', timeZone: 'UTC' } : { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

const peso = (value: number) => `₱${Math.round(value).toLocaleString('en-PH')}`

// A canvas keeps its on-screen size when printed, so it overflows its half of the page; and a
// picture made only when Print is pressed often isn't loaded in time, so the chart printed blank.
// So each chart is also drawn off screen, at a fixed size in light ink on white, whenever its data
// changes, and that picture is what prints.
const PRINT_SIZE = { width: 560, height: 200 }

function printImageOf(labels: string[], values: number[], format: (value: number) => string) {
  const ink = INK.light
  const holder = document.createElement('div')
  holder.style.cssText = `position:fixed;left:-10000px;top:0;width:${PRINT_SIZE.width}px;height:${PRINT_SIZE.height}px;`
  const canvas = document.createElement('canvas')
  canvas.width = PRINT_SIZE.width
  canvas.height = PRINT_SIZE.height
  holder.appendChild(canvas)
  document.body.appendChild(holder)
  try {
    const chart = new ChartJS(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          data: values,
          borderColor: ink.line,
          borderWidth: 2,
          cubicInterpolationMode: 'monotone',
          pointRadius: values.length <= 31 ? 3 : 0,
          pointBackgroundColor: ink.line,
          pointBorderColor: ink.surface,
          pointBorderWidth: 2,
        }],
      },
      options: {
        responsive: false,
        animation: false,
        devicePixelRatio: 2,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: { grid: { display: false }, border: { color: ink.grid }, ticks: { color: ink.text, font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } },
          y: { beginAtZero: true, grid: { color: ink.grid }, border: { display: false }, ticks: { color: ink.text, font: { size: 10 }, maxTicksLimit: 5, precision: 0, callback: (value) => format(Number(value)) } },
        },
      },
      // A white background, so the line shows on paper and in a saved PDF.
      plugins: [{
        id: 'whiteBackground',
        beforeDraw: (c) => {
          const ctx = c.ctx
          ctx.save()
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(0, 0, c.width, c.height)
          ctx.restore()
        },
      }],
    })
    const image = chart.toBase64Image('image/png', 1)
    chart.destroy()
    return image
  } catch {
    return ''
  } finally {
    holder.remove()
  }
}

function TrendChart({
  title,
  total,
  labels,
  values,
  format,
  ink,
  chartRef,
  printImage,
}: {
  title: string
  total: string
  labels: string[]
  values: number[]
  format: (value: number) => string
  ink: typeof INK.dark
  chartRef: React.MutableRefObject<ChartJS<'line'> | null>
  printImage?: string
}) {
  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        displayColors: false,
        callbacks: { label: (context) => format(Number(context.parsed.y) || 0) },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        border: { color: ink.grid },
        ticks: { color: ink.text, font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
      },
      y: {
        beginAtZero: true,
        grid: { color: ink.grid },
        border: { display: false },
        ticks: { color: ink.text, font: { size: 10 }, maxTicksLimit: 5, precision: 0, callback: (value) => format(Number(value)) },
      },
    },
  }
  const data = {
    labels,
    datasets: [{
      data: values,
      borderColor: ink.line,
      borderWidth: 2,
      // Smooth, but never curving above or below the real values between points.
      cubicInterpolationMode: 'monotone' as const,
      pointRadius: values.length <= 31 ? 3 : 0,
      pointHoverRadius: 5,
      pointBackgroundColor: ink.line,
      pointBorderColor: ink.surface,
      pointBorderWidth: 2,
    }],
  }
  return (
    <figure className="surface report-chart rounded-xl px-3 py-2">
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold">{title}</span>
        <span className="text-xs text-muted">{total}</span>
      </figcaption>
      <div className={`mt-1 h-40 ${printImage ? 'print:hidden' : ''}`}>
        <Line ref={chartRef} options={options} data={data} aria-label={`${title} over the report period`} role="img" />
      </div>
      {printImage ? <img src={printImage} alt={`${title} over the report period`} className="mt-1 hidden w-full print:block" /> : null}
    </figure>
  )
}

// Line charts for revenue collected and reservations over the report period, side by side on
// the same dates (two charts rather than one with two y-axes, since ₱ and counts don't share a scale).
export function ReportTrendCharts({ rows, start, end, byMonth }: { rows: Row[]; start: string; end: string; byMonth: boolean }) {
  const { theme } = useTheme()
  const revenueRef = useRef<ChartJS<'line'> | null>(null)
  const reservationsRef = useRef<ChartJS<'line'> | null>(null)

  const timeline = useMemo(() => fillTimeline(rows, start, end, byMonth), [rows, start, end, byMonth])
  const labels = timeline.map((row) => tickLabel(row.key))
  const ink = theme === 'light' ? INK.light : INK.dark

  // The print pictures, made ahead of time (see printImageOf) so they're ready when Print is pressed.
  const [printImages, setPrintImages] = useState<{ revenue?: string; reservations?: string }>({})
  useEffect(() => {
    setPrintImages({
      revenue: printImageOf(labels, timeline.map((row) => row.collected), peso) || undefined,
      reservations: printImageOf(labels, timeline.map((row) => row.reservations), (value) => value.toLocaleString('en-PH')) || undefined,
    })
    // labels follow timeline
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline])

  return (
    <div className="report-charts grid gap-2 md:grid-cols-2">
      <TrendChart
        title="Revenue collected"
        total={peso(timeline.reduce((sum, row) => sum + row.collected, 0))}
        labels={labels}
        values={timeline.map((row) => row.collected)}
        format={peso}
        ink={ink}
        chartRef={revenueRef}
        printImage={printImages.revenue}
      />
      <TrendChart
        title="Reservations"
        total={`${timeline.reduce((sum, row) => sum + row.reservations, 0)} total`}
        labels={labels}
        values={timeline.map((row) => row.reservations)}
        format={(value) => value.toLocaleString('en-PH')}
        ink={ink}
        chartRef={reservationsRef}
        printImage={printImages.reservations}
      />
    </div>
  )
}
