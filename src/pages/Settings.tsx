import { Layout } from '@/components/Layout';
import { Settings as SettingsIcon, Palette, Database, Bell } from 'lucide-react';

export default function Settings() {
  return (
    <Layout>
      <div className="p-6 lg:p-8 max-w-2xl">
        <div className="mb-8">
          <h1 className="font-display text-2xl font-bold">Settings</h1>
          <p className="text-sm text-muted-foreground">Customize your experience</p>
        </div>

        <div className="space-y-4">
          <div className="metric-card">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Palette className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold">Appearance</h3>
                <p className="text-sm text-muted-foreground">Theme and display settings</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">Coming soon...</p>
          </div>

          <div className="metric-card">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Bell className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold">Notifications</h3>
                <p className="text-sm text-muted-foreground">Timer and reminder settings</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">Coming soon...</p>
          </div>

          <div className="metric-card">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Database className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold">Data</h3>
                <p className="text-sm text-muted-foreground">Export and backup options</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Your data is currently stored locally in your browser. 
              Cloud sync coming soon.
            </p>
          </div>
        </div>
      </div>
    </Layout>
  );
}
