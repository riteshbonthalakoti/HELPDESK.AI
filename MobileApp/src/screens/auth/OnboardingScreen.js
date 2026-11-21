import React, { useState, useRef, useCallback, memo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  StatusBar,
  Animated,
  Dimensions,
  Image,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import { COLORS, SPACING, SHADOWS } from '../../styles/theme';
import { ArrowRight, Sparkles, BrainCircuit, Globe, Zap } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';

const { width, height } = Dimensions.get('window');

const SLIDES = [
  {
    id: '1',
    title: 'AI Neural Diagnostics',
    description: 'Instant IT ticket triage and categorization using state-of-the-art neural models.',
    icon: <BrainCircuit size={80} color="#10b981" />,
    color: '#10b981'
  },
  {
    id: '2',
    title: 'Omnichannel Input',
    description: 'Report issues using Voice, Screenshots, or Text in over 50+ languages.',
    icon: <Globe size={80} color="#3b82f6" />,
    color: '#3b82f6'
  },
  {
    id: '3',
    title: 'Rapid Resolution',
    description: 'Auto-resolution matching and rapid response times for mission-critical operations.',
    icon: <Zap size={80} color="#f59e0b" />,
    color: '#f59e0b'
  }
];

const SlideItem = memo(({ item }) => (
  <View style={styles.slide}>
    <View style={styles.iconWrapper}>
      <LinearGradient
        colors={['rgba(255,255,255,0.05)', 'rgba(255,255,255,0.02)']}
        style={styles.iconCircle}
      >
        {item.icon}
      </LinearGradient>
    </View>
    <Text style={styles.title}>{item.title}</Text>
    <Text style={styles.description}>{item.description}</Text>
  </View>
));

const OnboardingScreen = () => {
  const navigation = useNavigation();
  const [currentIndex, setCurrentIndex] = useState(0);
  const scrollX = useRef(new Animated.Value(0)).current;
  const flatListRef = useRef(null);

  const handleStart = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    await AsyncStorage.setItem('@onboarding_complete', 'true');
    navigation.replace('Login');
  };

  const handleNext = () => {
    if (currentIndex < SLIDES.length - 1) {
      flatListRef.current.scrollToIndex({ index: currentIndex + 1 });
    } else {
      handleStart();
    }
  };

  const onViewableItemsChanged = useRef(({ viewableItems }) => {
    if (viewableItems.length > 0) {
      setCurrentIndex(viewableItems[0].index);
    }
  }).current;

  const renderSlide = useCallback(({ item }) => (
    <SlideItem item={item} />
  ), []);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      
      <LinearGradient
        colors={['#0f1f12', '#0a2530']}
        style={StyleSheet.absoluteFill}
      />

      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Image 
            source={require('../../../assets/logo_v1.png')} 
            style={styles.logo} 
            resizeMode="contain" 
          />
          <Text style={styles.logoText}>HELPDESK<Text style={{ color: COLORS.primary }}>.AI</Text></Text>
        </View>

        <FlatList
          ref={flatListRef}
          data={SLIDES}
          renderItem={renderSlide}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { x: scrollX } } }],
            { useNativeDriver: false }
          )}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={{ itemVisiblePercentThreshold: 50 }}
          keyExtractor={(item) => item.id}
        />

        <View style={styles.footer}>
          <View style={styles.indicatorContainer}>
            {SLIDES.map((_, i) => {
              const inputRange = [(i - 1) * width, i * width, (i + 1) * width];
              const dotWidth = scrollX.interpolate({
                inputRange,
                outputRange: [10, 25, 10],
                extrapolate: 'clamp',
              });
              const opacity = scrollX.interpolate({
                inputRange,
                outputRange: [0.3, 1, 0.3],
                extrapolate: 'clamp',
              });
              return (
                <Animated.View
                  key={i}
                  style={[styles.dot, { width: dotWidth, opacity, backgroundColor: i === currentIndex ? COLORS.primary : 'rgba(255,255,255,0.3)' }]}
                />
              );
            })}
          </View>

          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={handleNext}
            activeOpacity={0.9}
          >
            <Text style={styles.btnText}>
              {currentIndex === SLIDES.length - 1 ? 'Get Started' : 'Next'}
            </Text>
            <ArrowRight size={22} color="#fff" />
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  safeArea: { flex: 1 },
  header: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'center', 
    marginTop: 20,
    gap: 12
  },
  logo: { width: 40, height: 40, borderRadius: 10 },
  logoText: { fontSize: 24, fontWeight: '900', color: '#fff', letterSpacing: 0.5 },
  slide: {
    width: width,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  iconWrapper: {
    marginBottom: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircle: {
    width: 180,
    height: 180,
    borderRadius: 90,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  title: {
    fontSize: 32,
    fontWeight: '900',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 20,
    letterSpacing: -1,
  },
  description: {
    fontSize: 17,
    color: 'rgba(255,255,255,0.6)',
    textAlign: 'center',
    lineHeight: 28,
    fontWeight: '500',
  },
  footer: { 
    paddingHorizontal: 32, 
    paddingBottom: 40,
    gap: 30
  },
  indicatorContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8
  },
  dot: {
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.primary,
  },
  primaryBtn: {
    height: 64,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    ...SHADOWS.medium,
  },
  btnText: { color: '#fff', fontSize: 18, fontWeight: '800' },
});

export default OnboardingScreen;
