import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useApp } from './context';
import { Loading } from './components/ui';
import Layout from './components/Layout';
import Auth from './pages/Auth';
import Dashboard from './pages/Dashboard';
import Campaigns from './pages/Campaigns';
import CampaignEditor from './pages/CampaignEditor';
import CampaignReport from './pages/CampaignReport';
import Contacts from './pages/Contacts';
import Lists from './pages/Lists';
import Templates from './pages/Templates';
import Senders from './pages/Senders';
import Activity from './pages/Activity';
import Businesses, { FirstBusiness } from './pages/Businesses';
import Settings from './pages/Settings';

/** Pages that need a business selected; shows onboarding when there are none. */
function NeedsBusiness({ children }) {
  const { bizLoaded, businessId } = useApp();
  if (!bizLoaded) return <Loading />;
  if (!businessId) return <FirstBusiness />;
  return children;
}

export default function App() {
  const { auth } = useApp();
  const location = useLocation();
  if (auth.loading) return <Loading />;
  if (!auth.user) return <Auth setup={auth.needsSetup} />;

  const b = (el) => <NeedsBusiness key={location.pathname}>{el}</NeedsBusiness>;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={b(<Dashboard />)} />
        <Route path="campaigns" element={b(<Campaigns />)} />
        <Route path="campaigns/:id/edit" element={b(<CampaignEditor />)} />
        <Route path="campaigns/:id" element={b(<CampaignReport />)} />
        <Route path="contacts" element={b(<Contacts />)} />
        <Route path="lists" element={b(<Lists />)} />
        <Route path="templates" element={b(<Templates />)} />
        <Route path="senders" element={b(<Senders />)} />
        <Route path="activity" element={b(<Activity />)} />
        <Route path="businesses" element={<Businesses />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
