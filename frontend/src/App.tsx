import { Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/AppLayout'
import { HomePage } from './pages/HomePage'
import { ComingSoonPage } from './pages/ComingSoonPage'

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<HomePage />} />
        <Route
          path="statements"
          element={<ComingSoonPage title="Statements" description="Upload and review bank statements. Coming soon." />}
        />
        <Route
          path="spending"
          element={<ComingSoonPage title="Spending" description="Category totals and searchable history. Coming soon." />}
        />
        <Route
          path="budget"
          element={<ComingSoonPage title="Budget" description="Monthly category limits and planning. Coming soon." />}
        />
        <Route
          path="insights"
          element={<ComingSoonPage title="Insights" description="Trends and optional AI explanations. Coming soon." />}
        />
        <Route
          path="profile"
          element={<ComingSoonPage title="Profile & privacy" description="Account, consent, export and deletion. Coming soon." />}
        />
        <Route path="*" element={<ComingSoonPage title="Page not found" description="That page does not exist." />} />
      </Route>
    </Routes>
  )
}
