import React from 'react';
import { TouchableOpacity, View, StyleSheet } from 'react-native';
import { PlusCircle } from 'lucide-react-native';

const FloatingActionButton = ({ onPress, color }) => {
  return (
    <TouchableOpacity
      style={styles.fab}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <PlusCircle size={28} color={color || '#ffffff' />
</PlusCircle>
</TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    bottom: 24,
    left: '50%',
    transform: [{ translateX: -28 }],
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#10b981',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
});

export { FloatingActionButton };