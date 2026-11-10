import io, sys

def load(p):
    raw = open(p, 'rb').read().decode('utf8')
    crlf = '\r\n' in raw
    return raw.replace('\r\n', '\n'), crlf

def save(p, s, crlf):
    open(p, 'wb').write((s.replace('\n', '\r\n') if crlf else s).encode('utf8'))

def edit(label, s, old, new, count=1):
    n = s.count(old)
    if n != count:
        print(f'  SKIPPED  {label}  (found {n} match(es), expected {count})')
        return s
    print(f'  OK       {label}')
    return s.replace(old, new)

print('App.tsx')
p = 'App.tsx'
s, crlf = load(p)
s = edit('Help screen imports', s,
  "import DisputeCenterScreen from './src/modules/Settings/DisputeCenterScreen';\n",
  "import HelpCenterScreen from './src/modules/Help/HelpCenterScreen';\n"
  "import ReportFlowScreen from './src/modules/Help/ReportFlowScreen';\n"
  "import TicketDetailScreen from './src/modules/Help/TicketDetailScreen';\n")
s = edit('remove old SupportScreen import', s,
  "import SupportScreen from './src/modules/Settings/SupportScreen';\n", "")
s = edit('remove old ReportIssueScreen import', s,
  "import ReportIssueScreen from './src/modules/Dashboard/Disputes/ReportIssueScreen';\n", "")
s = edit('param types: DisputeCenter', s,
  "  DisputeCenter: { mode?: 'provider' } | undefined;\n",
  "  DisputeCenter: { mode?: 'provider'; role?: 'sender' | 'provider' } | undefined;\n")
s = edit('param types: ReportIssue + TicketDetail', s,
  "  ReportIssue: { requestId?: number } | undefined;\n",
  "  ReportIssue: { role?: 'sender' | 'provider'; deliveryId?: number; requestId?: number } | undefined;\n"
  "  TicketDetail: { ticketId?: number; disputeId?: number };\n")
s = edit('ticket push notification', s,
  "      if (payload?.deliveryId && navigationRef.isReady?.()) {\n",
  "      if (payload?.type === 'ticket' && payload.ticketId && navigationRef.isReady?.()) {\n"
  "        navigationRef.navigate('TicketDetail', { ticketId: Number(payload.ticketId) });\n"
  "        return;\n"
  "      }\n\n"
  "      if (payload?.deliveryId && navigationRef.isReady?.()) {\n")
s = edit('routes', s,
  "        <Stack.Screen name=\"DisputeCenter\" component={DisputeCenterScreen} />\n"
  "        <Stack.Screen name=\"Support\" component={SupportScreen} />\n"
  "        <Stack.Screen name=\"ReportIssue\" component={ReportIssueScreen} />\n",
  "        {/* Old route names kept so every existing navigate() lands in the new Help flow */}\n"
  "        <Stack.Screen name=\"DisputeCenter\" component={HelpCenterScreen} />\n"
  "        <Stack.Screen name=\"Support\" component={HelpCenterScreen} />\n"
  "        <Stack.Screen name=\"ReportIssue\" component={ReportFlowScreen} />\n"
  "        <Stack.Screen name=\"TicketDetail\" component={TicketDetailScreen} />\n")
save(p, s, crlf)

print('BookingScreen.tsx')
p = 'src/modules/Dashboard/Sender/Delivery/BookingScreen.tsx'
s, crlf = load(p)
s = edit('BackHandler import', s,
  "Alert, Easing, ScrollView, Dimensions, ActivityIndicator, Platform,\n}",
  "Alert, Easing, ScrollView, Dimensions, ActivityIndicator, Platform, BackHandler,\n}")
s = edit('search duration 60s', s,
  "const SEARCH_DURATION_MS = 30000;\n",
  "// How long we search before offering \"Try Again\" / \"Go Home\". Change this one number to adjust.\n"
  "const SEARCH_DURATION_MS = 60000;\n")
s = edit('back lock while searching', s,
  "  }, [navigation]);\n\n  useEffect(() => {\n    if (bookingState === 'finding') {\n",
  "  }, [navigation]);\n\n"
  "  // During the first search window the user can't leave by swipe or the Android back button.\n"
  "  // (\"Cancel Search\" still works, and the lock lifts when the window ends.)\n"
  "  useEffect(() => {\n"
  "    const locked = bookingState === 'finding' && !longSearch;\n"
  "    navigation.setOptions({ gestureEnabled: !locked });\n"
  "    if (!locked) return;\n"
  "    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);\n"
  "    return () => sub.remove();\n"
  "  }, [bookingState, longSearch, navigation]);\n\n"
  "  useEffect(() => {\n    if (bookingState === 'finding') {\n")
s = edit('popTo MainTabs (x3)', s,
  "navigation.navigate('MainTabs');",
  "navigation.popTo('MainTabs'); // popTo: reuse the existing tabs; navigate() would push a 2nd MainTabs instance",
  count=3)
save(p, s, crlf)
print('Done. Any SKIPPED line means that change needs a manual look: tell me which one.')
