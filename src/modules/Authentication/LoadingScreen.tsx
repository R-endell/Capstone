import React, { useEffect } from 'react';
import { 
  View, Text, StyleSheet, Image, ActivityIndicator 
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../../App';

export default function LoadingScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  useEffect(() => {
    const timer = setTimeout(() => {
      navigation.reset({
        index: 0,
        routes: [{ name: 'Login' }],
      });
    }, 2500);

    return () => clearTimeout(timer);
  }, [navigation]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.contentContainer}>
        
        <View style={styles.logoSection}>
          <Image 
            source={require('../../../assets/Pack-N-Ship-Logo2.png')} 
            style={styles.logoImage} 
            resizeMode="contain" 
          />
          <Text style={styles.logoText}>
            Pack-<Text style={styles.logoTextOrange}>N</Text>
            <Text style={styles.logoTextOrange}>-Ship</Text>
          </Text>
        </View>

        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color="#F27024" style={styles.spinner} />
          <Text style={styles.loadingText}>Connecting to service</Text>
        </View>

      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: '#F9FAFB' 
  },
  contentContainer: {
    flex: 1,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 60,
  },
  logoSection: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoImage: {
    width: 260,
    height: 140,
    marginBottom: -35,
  },
  logoText: {
    fontSize: 44,
    fontWeight: '900',
    fontStyle: 'italic',
    color: '#111827',
  },
  logoTextOrange: {
    color: '#F27024',
  },
  loadingContainer: {
    alignItems: 'center',
    marginBottom: 40,
  },
  spinner: {
    marginBottom: 16,
    transform: [{ scale: 1.2 }],
  },
  loadingText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#6B7280',
    letterSpacing: 0.2,
  },
});