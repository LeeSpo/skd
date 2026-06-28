import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Terminal, Plus, FolderTree, Zap, Settings } from 'lucide-react';
import { Badge } from './ui/badge';

interface WelcomeScreenProps {
  onNewConnection: () => void;
  onOpenSettings: () => void;
}

export function WelcomeScreen({ onNewConnection, onOpenSettings }: WelcomeScreenProps) {
  const { t } = useTranslation();
  const quickActions = [
    {
      icon: Plus,
      title: t('welcome.newConnection'),
      description: t('welcome.newConnectionDesc'),
      action: onNewConnection,
      variant: 'default' as const,
      shortcut: '⌘N'
    },
    {
      icon: FolderTree,
      title: t('welcome.connectionManager'),
      description: t('welcome.connectionManagerDesc'),
      action: () => {},
      variant: 'outline' as const,
      highlight: 'Left sidebar ⌘B'
    },
    {
      icon: Settings,
      title: t('welcome.preferences'),
      description: t('welcome.preferencesDesc'),
      action: onOpenSettings,
      variant: 'outline' as const,
      shortcut: '⌘,'
    }
  ];

  return (
    <div className="h-full overflow-auto bg-gradient-to-br from-background via-background to-muted/20 flex items-center">
      <div className="max-w-3xl w-full mx-auto p-6 space-y-8 animate-in fade-in duration-500">
        {/* Hero Section */}
        <div className="flex items-center justify-center gap-3">
          <div className="p-3 bg-primary/10 rounded-xl border border-primary/20">
            <Terminal className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{t('app.title')}</h1>
        </div>

        {/* Quick Actions */}
        <Card className="border-2">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Zap className="h-4 w-4" />
              {t('welcome.getStarted')}
            </CardTitle>
            <CardDescription className="text-xs">
              {t('welcome.getStartedDesc')}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-3">
            {quickActions.map((action, index) => (
              <Card 
                key={index}
                className="relative overflow-hidden hover:shadow-md transition-all cursor-pointer group border-2 hover:border-primary/50"
                onClick={action.action}
              >
                <CardContent className="p-4">
                  <div className="flex flex-col items-center text-center space-y-2">
                    <div className="p-2.5 bg-primary/10 rounded-lg group-hover:bg-primary/20 transition-colors">
                      <action.icon className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-medium text-sm mb-0.5">{action.title}</h3>
                      <p className="text-xs text-muted-foreground">
                        {action.description}
                      </p>
                    </div>
                    {action.shortcut && (
                      <Badge variant="secondary" className="text-xs font-mono">
                        {action.shortcut}
                      </Badge>
                    )}
                    {action.highlight && (
                      <span className="text-xs text-primary font-medium">
                        {action.highlight}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </CardContent>
        </Card>

        {/* Call to Action */}
        <div className="text-center">
          <Button size="lg" onClick={onNewConnection} className="gap-2 shadow-lg">
            <Plus className="h-5 w-5" />
            {t('welcome.newConnection')}
          </Button>
          <p className="text-xs text-muted-foreground mt-2">
            {t('welcome.orPickFromSidebar')}
          </p>
        </div>
      </div>
    </div>
  );
}