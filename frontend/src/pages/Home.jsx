import { Link } from 'react-router-dom'

const tiles = [
  { to: '/chat', icon: '💬', title: 'Memory Chat', desc: 'Ask "Who is this?"' },
  { to: '/scan', icon: '🔍', title: 'Object Scan', desc: 'Find your things' },
  { to: '/caregiver', icon: '👪', title: 'Caregiver', desc: 'Add people & objects' },
]

export default function Home() {
  return (
    <div className="home">
      <h1>Hello — I'm here to help you remember.</h1>
      <p className="lead">Tap a big button below.</p>
      <div className="tiles">
        {tiles.map((t) => (
          <Link key={t.to} to={t.to} className="tile">
            <span className="tile-icon">{t.icon}</span>
            <span className="tile-title">{t.title}</span>
            <span className="tile-desc">{t.desc}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
