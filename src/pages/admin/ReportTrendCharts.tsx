import React, { useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
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

function TrendChart({
  title,
  total,
  labels,
  values,
  format,
  ink,
  chartRef,
}: {
  title: string
  total: string
  labels: string[]
  values: number[]
  format: (value: number) => string
  ink: typeof INK.dark
  chartRef: React.MutableRefObject<ChartJS<'line'> | null>
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
      tension: 0.25,
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
      <div className="mt-1 h-40">
        <Line ref={chartRef} options={options} data={data} aria-label={`${title} over the report period`} role="img" />
      </div>
    </figure>
  )
}

// Line charts for revenue collected and reservations over the report period, side by side on
// the same dates (two charts rather than one with two y-axes, since ₱ and counts don't share a scale).
export function ReportTrendCharts({ rows, start, end, byMonth }: { rows: Row[]; start: string; end: string; byMonth: boolean }) {
  const { theme } = useTheme()
  const [printing, setPrinting] = useState(false)
  const revenueRef = useRef<ChartJS<'line'> | null>(null)
  const reservationsRef = useRef<ChartJS<'line'> | null>(null)

  // Print with light ink and re-measure the canvases for the page width.
  useEffect(() => {
    const before = () => {
      flushSync(() => setPrinting(true))
      revenueRef.current?.resize()
      reservationsRef.current?.resize()
    }
    const after = () => {
      setPrinting(false)
      revenueRef.current?.resize()
      reservationsRef.current?.resize()
    }
    window.addEventListener('beforeprint', before)
    window.addEventListener('afterprint', after)
    return () => {
      window.removeEventListener('beforeprint', before)
      window.removeEventListener('afterprint', after)
    }
  }, [])

  const timeline = useMemo(() => fillTimeline(rows, start, end, byMonth), [rows, start, end, byMonth])
  const labels = timeline.map((row) => tickLabel(row.key))
  const ink = printing || theme === 'light' ? INK.light : INK.dark

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
      />
      <TrendChart
        title="Reservations"
        total={`${timeline.reduce((sum, row) => sum + row.reservations, 0)} total`}
        labels={labels}
        values={timeline.map((row) => row.reservations)}
        format={(value) => value.toLocaleString('en-PH')}
        ink={ink}
        chartRef={reservationsRef}
      />
    </div>
  )
}
