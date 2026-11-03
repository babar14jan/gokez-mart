import { useEffect } from 'react';
import { onOrderEvent, type LiveOrderEvent } from '../services/realtime';
import { startOrderAlarm, stopOrderAlarm } from '../services/orderAlarm';

export default function LiveOrderToasts() {
  useEffect(() => {
    const off = onOrderEvent((event: LiveOrderEvent) => {
      if (event.type !== 'order.created') return;
      startOrderAlarm();
    });
    return () => {
      off();
      stopOrderAlarm();
    };
  }, []);

  return null;
}