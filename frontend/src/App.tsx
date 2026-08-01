import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { auth, functions } from './firebase'
import Play from './pages/Play'
import InstructorDashboard from './pages/InstructorDashboard'
import Configure from './pages/Configure'
import Reports from './pages/Reports'
import { SettingsPage } from '@mygames/game-ui'

const graysRoleLabels: Record<string, string> = {
  chris: 'Chris',
  kelly: 'Kelly',
}

const graysInfoLinks = [
  { roleKey: 'chris', links: [
    { key: 'chris_sheet_url', label: 'Role sheet' },
  ]},
  { roleKey: 'kelly', links: [
    { key: 'kelly_sheet_url', label: 'Role sheet' },
  ]},
]

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/"          element={<Play />} />
        <Route path="/dashboard" element={<InstructorDashboard />} />
        <Route path="/configure" element={<Configure />} />
        <Route path="/reports"   element={<Reports />} />
        <Route path="/settings"  element={
          <SettingsPage
            title="Settings — Grays 2.0"
            functions={functions}
            auth={auth}
            roleLabels={graysRoleLabels}
            roleInfoLinks={graysInfoLinks}
          />
        } />
      </Routes>
    </BrowserRouter>
  )
}
