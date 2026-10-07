import { NavLink } from 'react-router-dom'

const links = [
  { to: '/', label: 'Home', end: true },
  { to: '/chat', label: 'Memory Chat' },
  { to: '/scan', label: 'Object Scan' },
  { to: '/caregiver', label: 'Caregiver' },
]

export default function Nav() {
  return (
    <header className="nav">
      <div className="brand">🧠 FacTech AI</div>
      <nav className="navlinks">
        {links.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.end}
            className={({ isActive }) => (isActive ? 'navlink active' : 'navlink')}
          >
            {l.label}
          </NavLink>
        ))}
      </nav>
    </header>
  )
}
