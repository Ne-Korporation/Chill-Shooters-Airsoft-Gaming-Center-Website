import React, { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  FiCheck,
  FiChevronRight,
  FiChevronLeft,
  FiShield,
  FiZap,
  FiMap,
  FiUsers,
  FiCreditCard,
  FiMessageSquare,
  FiHelpCircle,
} from 'react-icons/fi'

import { Button } from '../../components/ui/Button'
import { useTheme } from '../../context/ThemeContext'
import { ThemeToggle } from '../../components/nav/ThemeToggle'
import { Card } from '../../components/ui/Card'
import { apiGet, getApiBase } from '../../utils/apiClient'

type Testimonial = {
  name: string
  role: string
  quote: string
}

type FAQ = {
  q: string
  a: string
}

type LandingMetrics = {
  reservations: number
  pendingPayments: number
  pendingWaivers: number
  activeGames: number
  pendingItems: number
  readiness: number
  statusLabel: string
}

const initialMetrics: LandingMetrics = {
  reservations: 0,
  pendingPayments: 0,
  pendingWaivers: 0,
  activeGames: 0,
  pendingItems: 0,
  readiness: 100,
  statusLabel: 'Ready',
}

function CamouflageOverlay({ opacity = 0.1 }: { opacity?: number }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
      style={{ opacity }}
    >
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(135deg, rgba(47,79,47,1) 0%, rgba(18,18,18,0) 45%), linear-gradient(45deg, rgba(85,107,47,1) 0%, rgba(18,18,18,0) 55%)',
          mixBlendMode: 'overlay',
        }}
      />
      <div
        className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(197,163,90,0.35),transparent_35%),radial-gradient(circle_at_70%_35%,rgba(85,107,47,0.45),transparent_40%),radial-gradient(circle_at_45%_75%,rgba(47,79,47,0.55),transparent_45%)]"
        style={{ filter: 'blur(6px)' }}
      />
    </div>
  )
}


function SectionTitle({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string
  title: string
  subtitle?: string
}) {
  return (
    <div className="mb-6">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
        {eyebrow}
      </div>
      <h2 className="mt-2 text-2xl font-bold tracking-tight md:text-3xl">
        {title}
      </h2>
      {subtitle ? (
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted md:text-base">
          {subtitle}
        </p>
      ) : null}
    </div>
  )
}

export function LandingPage() {
  const { theme } = useTheme()
  const [faqOpen, setFaqOpen] = useState<number | null>(null)
  const [landingMetrics, setLandingMetrics] = useState<LandingMetrics>(initialMetrics)
  const [loadingMetrics, setLoadingMetrics] = useState(true)

  const handleFaqToggle = (idx: number, open: boolean) => {
    setFaqOpen(open ? null : idx)
  }
  const navigate = useNavigate()

  useEffect(() => {
    let isMounted = true

    const loadMetrics = async () => {
      setLoadingMetrics(true)
      try {
        const metricsRes = await apiGet<{
          ok: boolean
          data: {
            reservations: number
            pendingReservations: number
            pendingPayments: number
            pendingWaivers: number
            activeGames: number
          }
        }>('/api/public/metrics')
        const { reservations, pendingReservations, pendingPayments, pendingWaivers, activeGames } = metricsRes.data

        const pendingItems = pendingReservations + pendingPayments + pendingWaivers
        const readiness = Math.max(70, Math.min(100, 100 - pendingItems * 4))
        const statusLabel = pendingItems > 0 ? 'Needs follow-up' : 'Ready'

        if (isMounted) {
          setLandingMetrics({
            reservations,
            pendingPayments,
            pendingWaivers,
            activeGames,
            pendingItems,
            readiness,
            statusLabel,
          })
        }
      } catch (error) {
        if (isMounted) {
          setLandingMetrics(initialMetrics)
        }
      } finally {
        if (isMounted) {
          setLoadingMetrics(false)
        }
      }
    }

    void loadMetrics()
    return () => {
      isMounted = false
    }
  }, [])

  const handleContactClick = () => {
    if (typeof window !== 'undefined') {
      window.location.href =
        'mailto:support@chillshooters.com?subject=Inquiry%20from%20Chill%20Shooters%20Website'
    }
  }

  const [contactMessage, setContactMessage] = useState('')

  const handleContactSubmit = async (e: React.FormEvent | React.KeyboardEvent) => {
    if (e && 'preventDefault' in e) e.preventDefault()
    try {
      const apiBase = getApiBase()
      const res = await fetch(`${apiBase}/api/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: contactMessage }),
      })
      if (!res.ok) throw new Error('send failed')
      setContactMessage('')
      // eslint-disable-next-line no-alert
      alert('Message sent — thanks!')
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('contact send error', err)
      // Inform the user that sending failed and require SMTP configuration
      // eslint-disable-next-line no-alert
      alert('Failed to send message. Please check server SMTP configuration.')
    }
  }

  const features = useMemo(
    () =>
      [
        {
          icon: <FiShield className="h-5 w-5" />,
          title: 'Digital Waivers',
          desc: 'Capture signatures securely with guardian consent for minors.',
        },
        {
          icon: <FiZap className="h-5 w-5" />,
          title: 'Live Slot Control',
          desc: 'Reservation calendar prevents full schedules in real time.',
        },
        {
          icon: <FiUsers className="h-5 w-5" />,
          title: 'Player Profiles',
          desc: 'Track experience, equipment, history, and favorite game modes.',
        },
        {
          icon: <FiCreditCard className="h-5 w-5" />,
          title: 'Payment & Receipts',
          desc: 'Upload proof, view breakdowns, and generate a clean receipt preview.',
        },
      ] as const,
    [],
  )

  const testimonials: Testimonial[] = useMemo(
    () => [
      {
        name: 'Sgt. Ramos',
        role: 'Marshals Desk',
        quote:
          'The dashboard makes it easy to coordinate attendance and equipment distribution under pressure.',
      },
      {
        name: 'Liza M.',
        role: 'Regular Player',
        quote: 'Reservations feel fast and structured. No more confusion on slot availability or payments.',
      },
      {
        name: 'Karel V.',
        role: 'Registrar',
        quote:
          'Waivers are streamlined. The workflow is clean and consistent for every group.',
      },
    ],
    [],
  )

  const faqs: FAQ[] = useMemo(
    () => [
      {
        q: 'What is the age requirement to play?',
        a: 'Players of any age may join. Minors must be accompanied by a parent or guardian and must present a valid school ID. All players are required to sign a consent form on site.',
      },
      {
        q: 'Do you accept walk-in players?',
        a: 'Yes, walk-in players are accepted. However, due to limited equipment, advance reservation is highly recommended.',
      },
      {
        q: 'Can beginners or first-time players join?',
        a: 'Yes, the field is open to beginners, casual players, and experienced players. Game marshals are present to guide first-time players.',
      },
      {
        q: 'Is safety equipment required?',
        a: 'Yes, protective masks are required at all times during gameplay. Other safety rules will be discussed during the orientation.',
      },
      {
        q: 'What happens if it rains?',
        a: 'Games may continue depending on weather conditions. In case of unsafe conditions, the field management will provide further instructions.',
      },
      {
        q: 'Can players bring their own airsoft guns?',
        a: 'Yes, players who already have their own airsoft guns may use them, provided they pass the FPS and safety checks.',
      },
    ],
    [],
  )

  const stats = useMemo(
    () => [
      {
        label: 'Live reservations',
        value: loadingMetrics ? '…' : `${landingMetrics.reservations} active`,
      },
      {
        label: 'Pending payments',
        value: loadingMetrics ? '…' : `${landingMetrics.pendingPayments}`,
      },
      {
        label: 'Waiver queue',
        value: loadingMetrics ? '…' : `${landingMetrics.pendingWaivers}`,
      },
      {
        label: 'Active games',
        value: loadingMetrics ? '…' : `${landingMetrics.activeGames}`,
      },
    ],
    [landingMetrics, loadingMetrics],
  )

  const opsLines = useMemo(
    () => [
      {
        title: 'Reservations in motion',
        detail: loadingMetrics ? 'Syncing live counts…' : `${landingMetrics.reservations} active reservations`,
      },
      {
        title: 'Payments awaiting review',
        detail: loadingMetrics ? 'Syncing live counts…' : `${landingMetrics.pendingPayments} pending payment checks`,
      },
      {
        title: 'Waivers pending',
        detail: loadingMetrics ? 'Syncing live counts…' : `${landingMetrics.pendingWaivers} awaiting review`,
      },
      {
        title: 'Games in progress',
        detail: loadingMetrics ? 'Syncing live counts…' : `${landingMetrics.activeGames} current sessions`,
      },
    ],
    [landingMetrics, loadingMetrics],
  )

  return (
    <div className="relative min-h-screen bg-background text-text">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(85,107,47,0.28),transparent_55%),radial-gradient(circle_at_90%_20%,rgba(197,163,90,0.18),transparent_52%),radial-gradient(circle_at_60%_95%,rgba(47,79,47,0.22),transparent_60)] pointer-events-none" />
      <CamouflageOverlay opacity={0.1} />

      {/* Top nav */}
      <header className="sticky top-0 z-40 border-b border-white/5 bg-black/20 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between px-4 py-3 md:px-6">


          <div className="flex items-center gap-3">
            <img
              src={theme === 'light' ? '/loggingwebdark.png' : '/logingweb.png'}
              alt="A.B.P logo"
              className="h-12 w-12 object-contain md:h-14 md:w-14"
            />
                            <div>
                              <div className="text-sm font-bold tracking-wide">Chill Shooters Airsoft Gaming Center</div>
                              <div className="text-xs text-muted">
                                Airsoft Gaming Center
                              </div>
                            </div>
                          </div>

                          <nav className="hidden items-center gap-4 md:flex">
                            <a className="text-sm text-muted hover:text-text" href="#features">
                              Features
                            </a>
                            <a
                              className="text-sm text-muted hover:text-text"
                              href="#how-it-works"
                            >
                              How it works
                            </a>
                            <a className="text-sm text-muted hover:text-text" href="#faq">
                              FAQ
                            </a>
                            <a
                              className="text-sm text-muted hover:text-text"
                              href="#contact"
                            >
                              Contact
                            </a>
                          </nav>

                          <div className="flex items-center gap-2">
                            <div className="hidden sm:block mr-2">
                              <ThemeToggle />
                            </div>
                            <Button variant="ghost" className="hidden md:inline-flex">
                              <Link to="/login">Login</Link>
                            </Button>
                            <Button className="relative overflow-hidden" variant="primary">
                              <Link to="/register" className="flex items-center gap-2">
                                Start Reservation
                                <FiChevronRight />
                              </Link>
                            </Button>
                          </div>
                        </div>
          </header>

      {/* Hero */}
      <section className="relative mx-auto max-w-[1400px] px-4 pb-10 pt-14 md:px-6 md:pb-16 md:pt-20">
        <div className="grid items-center gap-8 lg:grid-cols-2">

          <div>
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className={`inline-flex items-center gap-2 rounded-full border ${theme === 'light' ? 'border-gray-200/60' : 'border-white/10'} bg-white/5 px-3 py-1 text-xs text-muted`}
            >
              <span className="h-2 w-2 rounded-full bg-gold" />
              Inventory & Player Control—built for speed
            </motion.div>

            <h1 className="mt-5 text-4xl font-black tracking-tight md:text-6xl">
              The #1 Airsoft Gaming Center
              <span className="text-gold"> in Cavite</span>.
            </h1>

            <p className="mt-5 max-w-xl text-sm leading-relaxed text-muted md:text-base">
              “Aim. Book. Play.” keeps reservations, waivers, payments, and admin
              workflows consistent.
            </p>

            <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button variant="primary">
                <Link to="/register">Reserve a Slot</Link>
              </Button>
              <Button variant="ghost">
                <Link
                  to="/login"
                  className="flex items-center gap-2"
                >
                  Access Dashboard <FiChevronRight />
                </Link>
              </Button>
            </div>

            <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {stats.map((s, idx) => (
                <motion.div
                  key={s.label}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, delay: idx * 0.06 }}
                  className={`rounded-2xl border ${theme === 'light' ? 'border-gray-200/60' : 'border-white/10'} bg-white/5 p-3 backdrop-blur`}
                >
                  <div className="text-sm font-bold">{s.value}</div>
                  <div className="mt-1 text-xs text-muted">{s.label}</div>
                </motion.div>
              ))}
            </div>
          </div>

          <div className="relative">
            <motion.div
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6 }}
              className={`relative overflow-hidden rounded-3xl border ${theme === 'light' ? 'border-gray-200/60' : 'border-white/10'} bg-white/5 p-5 shadow-xl`}
            >
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(197,163,90,0.35),transparent_40%),radial-gradient(circle_at_75%_30%,rgba(85,107,47,0.25),transparent_45%),linear-gradient(180deg,rgba(18,18,18,0.0),rgba(18,18,18,0.55))] pointer-events-none" />
              <CamouflageOverlay opacity={0.14} />

              <div className="relative">
                <div className="flex items-center justify-between">
                  <div className={`text-xs uppercase tracking-widest ${theme === 'light' ? 'text-gray-600' : 'text-muted'}`}>
                    Live Ops
                  </div>
                  <div className={`rounded-full border ${theme === 'light' ? 'border-gray-200/60' : 'border-white/10'} bg-black/40 px-3 py-1 text-xs ${theme === 'light' ? 'text-gray-800' : 'text-muted'}`}>
                    Status: {loadingMetrics ? 'Syncing' : landingMetrics.statusLabel}
                  </div>
                </div>

                <div className="mt-4 grid gap-3">
                  {opsLines.map((line, i) => (
                    <div
                      key={line.title}
                      className={`flex items-start gap-3 rounded-2xl ${theme === 'light' ? 'bg-white/10' : 'bg-black/20'} px-3 py-3 ring-1 ${theme === 'light' ? 'ring-gray-200/30' : 'ring-white/5'}`}
                    >
                      <div className={`mt-0.5 grid h-7 w-7 place-items-center rounded-xl bg-[linear-gradient(135deg,rgba(197,163,90,0.35),rgba(47,79,47,0.1))] ring-1 ${theme === 'light' ? 'ring-gray-200/30' : 'ring-white/10'}`}>
                        <FiCheck className="h-4 w-4 text-gold" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold">{line.title}</div>
                        <div className={`${theme === 'light' ? 'text-gray-800 text-xs' : 'text-xs text-muted'}`}>{line.detail}</div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-5 grid grid-cols-2 gap-3">
                  <div className={`rounded-2xl bg-white/5 p-3 ring-1 ${theme === 'light' ? 'ring-gray-200/30' : 'ring-white/10'}`}>
                    <div className={`${theme === 'light' ? 'text-gray-700 text-xs' : 'text-xs text-muted'}`}>Operations focus</div>
                    <div className="mt-1 text-sm font-bold">{loadingMetrics ? 'Syncing…' : landingMetrics.pendingItems > 0 ? `${landingMetrics.pendingItems} items need review` : 'All queues clear'}</div>
                  </div>
                  <div className={`rounded-2xl bg-white/5 p-3 ring-1 ${theme === 'light' ? 'ring-gray-200/30' : 'ring-white/10'}`}>
                    <div className={`${theme === 'light' ? 'text-gray-700 text-xs' : 'text-xs text-muted'}`}>Equipment risk</div>
                    <div className={`mt-1 text-sm font-bold ${landingMetrics.pendingItems > 0 ? 'text-danger' : 'text-success'}`}>{loadingMetrics ? 'Syncing…' : landingMetrics.pendingItems > 0 ? 'Needs review' : 'Low'}</div>
                  </div>
                </div>

                <div className={`mt-4 rounded-2xl border ${theme === 'light' ? 'border-gray-200/60' : 'border-white/10'} bg-black/25 p-3`}>
                  <div className="flex items-center justify-between">
                    <div className="text-white text-xs">Operational readiness</div>
                    <div className="text-xs font-semibold text-gold">{loadingMetrics ? '…' : `${landingMetrics.readiness}%`}</div>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/5">
                    <motion.div
                      className="h-full bg-[linear-gradient(90deg,rgba(197,163,90,0.9),rgba(85,107,47,0.8))]"
                      initial={{ width: 0 }}
                      animate={{ width: loadingMetrics ? '0%' : `${landingMetrics.readiness}%` }}
                      transition={{ duration: 0.9, ease: 'easeOut' }}
                    />
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-[1400px] px-4 pb-12 md:px-6 md:pb-16">
        <SectionTitle
          eyebrow="Capability Pack"
          title="Built for reservations, players, and admin operations"
          subtitle=""
        />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((f, idx) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.35 }}
              transition={{ duration: 0.4, delay: idx * 0.04 }}
            >
              <Card className={`relative overflow-hidden rounded-2xl border ${theme === 'light' ? 'border-gray-200/60' : 'border-white/10'} bg-white/5 p-5`}>
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(197,163,90,0.25),transparent_40%)] opacity-80 pointer-events-none" />
                <div className="relative">
                  <div className="flex items-center gap-3">
                    <div className="grid h-11 w-11 place-items-center rounded-2xl bg-[linear-gradient(135deg,rgba(47,79,47,0.9),rgba(18,18,18,0.25))] ring-1 ring-white/10">
                      <span className="text-gold">{f.icon}</span>
                    </div>
                    <div className="text-base font-bold">{f.title}</div>
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-muted">{f.desc}</p>
                  <div className="mt-4 inline-flex items-center gap-2 text-xs font-semibold text-gold">
                    <span className="h-1.5 w-1.5 rounded-full bg-gold" />
                    Operational ready
                  </div>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="mx-auto max-w-[1400px] px-4 pb-12 md:px-6 md:pb-16">
        <SectionTitle
          eyebrow="Operational Flow"
          title="How it works"
          subtitle=""
        />

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            {[
              {
                icon: <FiMap className="h-5 w-5" />,
                step: '01',
                title: 'Reserve & lock slots',
                desc: 'Pick field, date, and time window. The calendar blocks full schedules to prevent conflicts.',
              },
              {
                icon: <FiZap className="h-5 w-5" />,
                step: '02',
                title: 'Select equipment & mode',
                desc: 'Choose your game mode and gear. Pricing updates dynamically based on selection.',
              },
              {
                icon: <FiShield className="h-5 w-5" />,
                step: '03',
                title: 'Complete digital waiver',
                desc: 'Sign electronically and confirm guardian consent if a minor is participating.',
              },
            ].map((item, idx) => (
              <motion.div
                key={item.step}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.25 }}
                transition={{ duration: 0.35, delay: idx * 0.05 }}
              >
                <div className={`relative overflow-hidden rounded-2xl border ${theme === 'light' ? 'border-gray-200/60' : 'border-white/10'} bg-white/5 p-5`}>
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_30%,rgba(85,107,47,0.25),transparent_45%)] pointer-events-none" />
                  <div className="relative flex gap-4">
                    <div className="grid h-12 w-12 place-items-center rounded-2xl bg-black/30 ring-1 ring-white/10">
                      <div className="text-gold">{item.icon}</div>
                    </div>
                    <div>
                      <div className="text-xs font-bold tracking-[0.2em] text-muted">{item.step}</div>
                      <div className="mt-1 text-lg font-bold">{item.title}</div>
                      <div className="mt-2 text-sm text-muted">{item.desc}</div>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>

          <div className="space-y-4">
            {[
              {
                icon: <FiCreditCard className="h-5 w-5" />,
                step: '04',
                title: 'Pay & upload proof',
                desc: 'Choose GCash or bank transfer. Upload reference details and proof for verification.',
              },
              {
                icon: <FiCheck className="h-5 w-5" />,
                step: '05',
                title: 'Admin confirms',
                desc: 'Marshals/registrars approve reservations and equipment status with clear visibility.',
              },
              {
                icon: <FiMessageSquare className="h-5 w-5" />,
                step: '06',
                title: 'Show up & play',
                desc: 'Participants receive a streamlined confirmation flow and reservation history.',
              },
            ].map((item, idx) => (
              <motion.div
                key={item.step}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.25 }}
                transition={{ duration: 0.35, delay: idx * 0.05 }}
              >
                <div className={`relative overflow-hidden rounded-2xl border ${theme === 'light' ? 'border-gray-200/60' : 'border-white/10'} bg-white/5 p-5`}>
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_75%_35%,rgba(197,163,90,0.22),transparent_45%)] pointer-events-none" />
                  <div className="relative flex gap-4">
                    <div className="grid h-12 w-12 place-items-center rounded-2xl bg-black/30 ring-1 ring-white/10">
                      <div className="text-gold">{item.icon}</div>
                    </div>
                    <div>
                      <div className="text-xs font-bold tracking-[0.2em] text-muted">{item.step}</div>
                      <div className="mt-1 text-lg font-bold">{item.title}</div>
                      <div className="mt-2 text-sm text-muted">{item.desc}</div>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}

            <div className={`rounded-2xl border ${theme === 'light' ? 'border-gray-200/60' : 'border-white/10'} bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(0,0,0,0.2))] p-5`}>
              <div className="text-sm font-bold">Need a guided walkthrough?</div>
              <div className="mt-2 text-sm text-muted">
                Start your first reservation and explore the dashboard modules.
              </div>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <Button variant="primary">
                  <Link to="/register">Create Account</Link>
                </Button>
                <Button variant="ghost">
                  <Link to="/login" className="flex items-center gap-2">
                    Sign In
                    <FiChevronRight />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="mx-auto max-w-[1400px] px-4 pb-12 md:px-6 md:pb-16">
        <SectionTitle
          eyebrow="Field Feedback"
          title="Trusted by teams and regular players"
          subtitle="Realistic workflows designed to reduce errors during busy reservation periods."
        />
        <div className="grid gap-4 md:grid-cols-3">
          {testimonials.map((t, idx) => (
            <motion.div
              key={t.name}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 0.4, delay: idx * 0.04 }}
            >
              <Card className={`relative overflow-hidden rounded-2xl border ${theme === 'light' ? 'border-gray-200/60' : 'border-white/10'} bg-white/5 p-5`}>
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(197,163,90,0.18),transparent_45%)] pointer-events-none" />
                <div className="relative">
                  <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted">
                    {t.role}
                  </div>
                  <div className="mt-2 text-base font-bold">{t.name}</div>
                  <p className="mt-3 text-sm leading-relaxed text-muted">
                    “{t.quote}”
                  </p>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="mx-auto max-w-[1400px] px-4 pb-12 md:px-6 md:pb-16 pointer-events-auto">
        <SectionTitle
          eyebrow="Answers"
          title="FAQ"
          subtitle="Short, practical answers—built for players and staff."
        />

        <div className="space-y-3">
          {faqs.map((f, idx) => {
            const open = faqOpen === idx
            return (
              <motion.div
                key={f.q}
                className={`overflow-hidden rounded-2xl border ${theme === 'light' ? 'border-gray-200/60' : 'border-white/10'} bg-white/5 pointer-events-auto relative z-10`}
                initial={false}
                layout
                animate={{ backgroundColor: open ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.03)' }}
                transition={{ duration: 0.2 }}
              >
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={`faq-content-${idx}`}
                  className="flex w-full items-center justify-between gap-4 p-5 text-left"
                  onClick={() => handleFaqToggle(idx, open)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      handleFaqToggle(idx, open)
                    }
                  }}
                >
                  <div>
                    <div className="text-sm font-bold">{f.q}</div>
                    <div className="mt-1 text-xs text-muted">Tap to {open ? 'collapse' : 'expand'}</div>
                  </div>
                  <div className={`grid h-10 w-10 place-items-center rounded-2xl bg-black/25 ring-1 ${theme === 'light' ? 'ring-gray-200/30' : 'ring-white/10'} text-gold`}>
                    <FiHelpCircle className="h-5 w-5" />
                  </div>
                </button>

                <div
                  id={`faq-content-${idx}`}
                  className={`px-5 pb-5 transition-all duration-200 overflow-hidden ${
                    open ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
                  }`}
                >
                  <p className="text-sm leading-relaxed text-muted">{f.a}</p>
                </div>
              </motion.div>
            )
          })}
        </div>
      </section>

      <section className="mx-auto max-w-[1400px] px-4 pb-12 md:px-6 md:pb-16">
         <div className={`mt-6 rounded-[32px] border ${theme === 'light' ? 'border-gray-200/60' : 'border-white/10'} bg-[linear-gradient(135deg,rgba(255,255,255,0.10),rgba(0,0,0,0.28))] p-4 md:p-6 lg:p-8`}>
                <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                  <div className="max-w-2xl">
                    <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted">
                      Our Locations
                    </div>
                    <div className="mt-2 text-2xl font-bold sm:text-3xl">Three distinct spaces for every playstyle</div>
                  </div>
                  <div className={`hidden h-14 w-14 items-center justify-center rounded-3xl border ${theme === 'light' ? 'border-gray-200/60' : 'border-white/10'} bg-black/20 text-gold md:flex`}>
                    <span className="text-2xl">📍</span>
                  </div>
                </div>
                <div className="mt-6 grid gap-5 xl:grid-cols-3">
                  {([
                    {
                      name: 'Delta Stronghold (Salawag)',
                      img: '/delta.png',
                      desc: 'Approximately 2 hectares. Can hold up to 400 Players. Ideal for small to medium groups and tournaments.',
                    },
                    {
                      name: 'Delta Stronghold (Langkaan)',
                      img: '/delta.png',
                      desc: 'Approximately 2 hectares. Can hold up to 400 Players. Ideal for small to medium groups and tournaments.',
                    },
                    {
                      name: 'LOMA Binan Laguna',
                      img: '/loma.png',
                      desc: 'Approximately 4 hectares. Can hold up to 600 players. Ideal for large groups and tournaments.',
                    },
                  ] as const).map((loc) => (
                    <div
                      key={loc.name}
                      className={`flex h-full min-h-[420px] flex-col overflow-hidden rounded-[28px] border ${theme === 'light' ? 'border-gray-200/60' : 'border-white/10'} bg-black/25 shadow-[0_25px_80px_rgba(0,0,0,0.35)]`}
                    >
                      <div className="aspect-[4/3] w-full">
                        <img
                          src={loc.img}
                          alt={loc.name}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      </div>
                      <div className="flex-1 p-5 md:p-6">
                        <div className="text-xl font-bold">{loc.name}</div>
                        <div className="mt-3 text-base leading-7 text-muted">
                          {loc.desc}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
      </section>

      {/* Contact + Footer */}
      <section id="contact" className="mx-auto max-w-[1400px] px-4 pb-14 md:px-6 md:pb-18">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className={`rounded-3xl border ${theme === 'light' ? 'border-gray-200/60' : 'border-white/10'} bg-white/5 p-6 md:p-8`}>
            <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted">
              Contact
            </div>
            <div className="mt-3 text-2xl font-bold">Coordinate with Chill Shooters</div>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              Any questions you want to ask? Reach out to us and we will get back to you as soon as possible.
            </p>

            <div className="mt-5 space-y-3">
              <div className={`flex items-center gap-3 rounded-2xl bg-black/25 p-4 ring-1 ${theme === 'light' ? 'ring-gray-200/30' : 'ring-white/5'}`}>
                <div className="grid h-10 w-10 place-items-center rounded-2xl bg-[linear-gradient(135deg,rgba(197,163,90,0.25),rgba(47,79,47,0.1))] ring-1 ring-white/10">
                  <span className="text-gold">☎</span>
                </div>
                <div>
                  <div className="text-sm font-bold">Operations Desk</div>
                  <div className="text-xs text-muted">support@chillshooters.com</div>
                </div>
              </div>

  

              <form onSubmit={handleContactSubmit} className="space-y-3 w-full">
                <div className={`flex w-full items-start gap-3 rounded-2xl bg-black/25 p-4 ring-1 ${theme === 'light' ? 'ring-gray-200/30' : 'ring-white/5'}`}>
                  <div className="grid h-10 w-10 place-items-center rounded-2xl bg-[linear-gradient(135deg,rgba(85,107,47,0.25),rgba(18,18,18,0.1))] ring-1 ring-white/10">
                    <span className="text-gold">✉</span>
                  </div>
                  <div className="flex-1">
                    <label htmlFor="contactMessage" className="text-sm font-bold block">
                      Contact Us
                    </label>
                    <div className="text-xs text-muted">support@chillshooters.com</div>
                    <textarea
                      id="contactMessage"
                      value={contactMessage}
                      onChange={(ev) => setContactMessage(ev.target.value)}
                      onKeyDown={(ev) => {
                        if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
                          handleContactSubmit(ev)
                        }
                      }}
                      placeholder="Write your message here."
                      rows={4}
                      className="mt-2 w-full resize-y rounded-md bg-transparent text-sm text-text placeholder:text-muted focus:outline-none"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button type="submit" variant="primary">Send Message</Button>
                  <Button type="button" variant="ghost" onClick={() => setContactMessage('')}>Clear</Button>
                </div>
              </form>
            </div>
          </div>
          <div className={`rounded-3xl border ${theme === 'light' ? 'border-gray-200/60' : 'border-white/10'} bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(0,0,0,0.16))] p-6 md:p-8`}>
            <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Location Map</div>
            <div className="mt-4">
              <div className={`overflow-hidden rounded-lg ring-1 ${theme === 'light' ? 'ring-gray-200/30' : 'ring-white/5'}`}>
                <div className="aspect-[16/9] w-full bg-black/10">
                  <iframe
                    title="Chill Shooters locations"
                    src="https://www.google.com/maps?q=Chill%20Shooters%20Airsoft&output=embed"
                    className="h-full w-full border-0"
                    loading="lazy"
                  />
                </div>
              </div>
              <div className="mt-3 text-xs text-muted">
                <a href="https://www.google.com/maps/search/?api=1&query=Chill+Shooters+Airsoft" target="_blank" rel="noreferrer" className="underline">Open in Google Maps</a>
              </div>
            </div>
          </div>
        </div>

        <footer className="mt-10 border-t border-white/5 pt-8 text-center text-xs text-muted">
          © {new Date().getFullYear()} Chill Shooters Airsoft — Aim. Book. Play.
        </footer>
      </section>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-[radial-gradient(circle_at_50%_100%,rgba(197,163,90,0.18),transparent_60%)]" />
    </div>
  )
}
