import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, TouchableOpacity } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  Ticket,
  PlusCircle,
  BookOpen,
  LayoutDashboard,
  Inbox,
  Users,
  Settings,
  AlertCircle,
  Home,
} from 'lucide-react-native';
import { FAB } from './src/components/FloatingActionButton';
import { supabase } from './src/lib/supabase';
import { COLORS } from './src/styles/theme';

import OnboardingScreen from './src/screens/auth/OnboardingScreen';
import LoginScreen from './src/screens/auth/LoginScreen';
import SignupScreen from './src/screens/auth/SignupScreen';
import PendingApprovalScreen from './src/screens/auth/PendingApprovalScreen';

import TicketsListScreen from './src/screens/user/TicketsListScreen';
import CreateTicketScreen from './src/screens/user/CreateTicketScreen';
import TicketDetailScreen from './src/screens/user/TicketDetailScreen';
import KnowledgeBaseScreen from './src/screens/user/KnowledgeBaseScreen';
import UserProfileScreen from './src/screens/user/UserProfileScreen';
import { NotificationProvider } from './src/components/NotificationProvider';

import AdminDashboardScreen from './src/screens/admin/AdminDashboardScreen';
import AdminTicketsScreen from './src/screens/admin/AdminTicketsScreen';
import AdminTicketDetailScreen from './src/screens/admin/AdminTicketDetailScreen';
import AdminUsersScreen from './src/screens/admin/AdminUsersScreen';
import AdminSettingsScreen from './src/screens/admin/AdminSettingsScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator;

// Custom tab bar component with FAB for user navigator
const UserTabBar = ({ state, navigation }) => {
  const onNewTicketPress = () => {
    navigation.navigate('NewTicket');
  };

  return (
    <View style={styles.tabBarContainer}>
      <View style={styles.tabBarLeft}>
        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => navigation.navigate('Home')}
          activeOpacity={0.8}
        >
          <Home size={24} color={COLORS.primary} />
        </TouchableOpacity>
      </View>

      <View style={styles.tabBarCenter}>
        <FAB onPress={onNewTicketPress} color={COLORS.primary} />
      </View>

      <View style={styles.tabBarRight}>
        <View style={styles.tabBarGroup}>
          <TouchableOpacity
            style={styles.tabItem}
            onPress={() => navigation.navigate('Tickets')}
            activeOpacity={0.8}
          >
            <Ticket size={24} color={COLORS.primary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.tabItem}
            onPress={() => navigation.navigate('Alerts')}
            activeOpacity={0.8}
          >
            <AlertCircle size={24} color={COLORS.primary} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => navigation.navigate('Profile')}
          activeOpacity={0.8}
        >
          <Settings size={24} color={COLORS.primary} />
        </TouchableOpacity>
      </View>
    </View>
  );
};

const AdminTabBar = ({ state, navigation }) => {
  return (
    <View style={styles.adminTabBarContainer}>
      <View style={styles.adminTabBarLeft}>
        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => navigation.navigate('Overview')}
          activeOpacity={0.8}
        >
          <LayoutDashboard size={24} color={COLORS.primary} />
        </TouchableOpacity>
      </View>

      <View style={styles.adminTabBarCenter}>
        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => navigation.navigate('Tickets')}
          activeOpacity={0.8}
        >
          <Inbox size={24} color={COLORS.primary} />
        </TouchableOpacity>
      </View>

      <View style={styles.adminTabBarRight}>
        <View style={styles.adminTabBarGroup}>
          <TouchableOpacity
            style={styles.tabItem}
            onPress={() => navigation.navigate('Users')}
            activeOpacity={0.8}
          >
            <Users size={24} color={COLORS.primary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.tabItem}
            onPress={() => navigation.navigate('Analytics')}
            activeOpacity={0.8}
          >
            <BarChart3 size={24} color={COLORS.primary} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => navigation.navigate('AdminSettings')}
          activeOpacity={0.8}
        >
          <Settings size={24} color={COLORS.primary} />
        </TouchableOpacity>
      </View>
    </View>
  );
};

function UserTabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: COLORS.textMuted,
        tabBarStyle: styles.tabBar,
        tabBarLabelStyle: styles.tabLabel,
        tabBarComponent: UserTabBar,
      }}
    >
      <Tab.Screen
        name="Home"
        component={TicketsListScreen}
        options={{
          tabBarLabel: 'Home',
          tabBarIcon: () => null,
        }}
      />
      <Tab.Screen
        name="Tickets"
        component={TicketsListScreen}
        options={{
          tabBarLabel: 'Tickets',
          tabBarIcon: () => null,
        }}
      />
      <Tab.Screen
        name="Alerts"
        component={KnowledgeBaseScreen}
        options={{
          tabBarLabel: 'Alerts',
          tabBarIcon: () => null,
        }}
      />
      <Tab.Screen
        name="Profile"
        component={UserProfileScreen}
        options={{
          tabBarLabel: 'Profile',
          tabBarIcon: () => null,
        }}
      />
    </Tab.Navigator>
  );
}

function AdminTabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: COLORS.textMuted,
        tabBarStyle: styles.tabBar,
        tabBarLabelStyle: styles.tabLabel,
        tabBarComponent: AdminTabBar,
      }}
    >
      <Tab.Screen
        name="Overview"
        component={AdminDashboardScreen}
        options={{
          tabBarLabel: 'Overview',
          tabBarIcon: () => null,
        }}
      />
      <Tab.Screen
        name="Tickets"
        component={AdminTicketsScreen}
        options={{
          tabBarLabel: 'Tickets',
          tabBarIcon: () => null,
        }}
      />
      <Tab.Screen
        name="Users"
        component={AdminUsersScreen}
        options={{
          tabBarLabel: 'Users',
          tabBarIcon: () => null,
        }}
      />
      <Tab.Screen
        name="Analytics"
        component={AdminTicketDetailScreen}
        options={{
          tabBarLabel: 'Analytics',
          tabBarIcon: () => null,
        }}
      />
      <Tab.Screen
        name="AdminSettings"
        component={AdminSettingsScreen}
        options={{
          tabBarLabel: 'Settings',
          tabBarIcon: () => null,
        }}
      />
    </Tab.Navigator>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [role, setRole] = useState('user');
  const [status, setStatus] = useState('active');
  const [booting, setBooting] = useState(true);

  const resolveRole = async (activeSession, isMounted = true) => {
    if (!activeSession?.user?.id) {
      if (isMounted) {
        setSession(null);
        setRole('user');
        setStatus('active');
        setBooting(false);
      }
      return;
    }
    try {
      const { data } = await supabase
        .from('profiles')
        .select('role, status')
        .eq('id', activeSession.user.id)
        .single();
      if (isMounted) {
        setSession(activeSession);
        setRole(data?.role || 'user');
        setStatus(data?.status || 'active');
      }
    } catch {
      if (isMounted) {
        setSession(activeSession);
        setRole('user');
        setStatus('active');
      }
    } finally {
      if (isMounted) setBooting(false);
    }
  };

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => resolveRole(data?.session || null, mounted));

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      resolveRole(nextSession, mounted);
    });

    return () => {
      mounted = false;
      if (typeof listener?.subscription?.unsubscribe === 'function') {
        listener.subscription.unsubscribe();
      } else if (typeof listener?.unsubscribe === 'function') {
        listener.unsubscribe();
      }
    };
  }, []);

  if (booting) {
    return (
      <SafeAreaProvider>
        <View style={styles.splash}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.splashText}>Loading HELPDESK.AI…</Text>
        </View>
      </SafeAreaProvider>
    );
  }

  const isPending =
    status === 'pending_approval' || role === 'pending_approval' || status === 'pending';
  const isAdmin = role === 'admin' || role === 'master_admin' || role === 'super_admin';

  return (
    <SafeAreaProvider>
      <NotificationProvider>
        <StatusBar style="dark" />
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            {!session ? (
              <>
                <Stack.Screen name="Login" component={LoginScreen} />
                <Stack.Screen name="Signup" component={SignupScreen} />
                <Stack.Screen name="Onboarding" component={OnboardingScreen} />
              </>
            ) : isPending ? (
              <Stack.Screen name="PendingApproval" component={PendingApprovalScreen} />
            ) : isAdmin ? (
              <>
                <Stack.Screen name="AdminMain" component={AdminTabNavigator} />
                <Stack.Screen name="AdminTicketDetail" component={AdminTicketDetailScreen} />
              </>
            ) : (
              <>
                <Stack.Screen name="UserMain" component={UserTabNavigator} />
                <Stack.Screen name="TicketDetail" component={TicketDetailScreen} />
              </>
            )}
          </Stack.Navigator>
        </NavigationContainer>
      </NotificationProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: '#0b1f17',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  splashText: {
    color: '#d1fae5',
    fontSize: 14,
    fontWeight: '600',
  },
  tabBar: {
    backgroundColor: 'rgba(246,248,247,0.8)',
    borderTopColor: 'rgba(229,231,219,0.3)',
    borderTopWidth: 1,
    minHeight: 80,
    paddingBottom: 16,
    paddingTop: 6,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: '700',
  },
  tabBarContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 20,
  },
  tabBarLeft: {
    flex: 1,
    justifyContent: 'center',
  },
  tabBarCenter: {
    width: 56,
    height: 56,
  },
  tabBarRight: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  adminTabBarContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 20,
    paddingBottom: 4,
  },
  adminTabBarLeft: {
    flex: 1,
    justifyContent: 'center',
  },
  adminTabBarCenter: {
    width: 48,
    height: 48,
  },
  adminTabBarRight: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  adminTabBarGroup: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: -8,
  },
  tabItem: {
    alignItems: 'center',
  },
});