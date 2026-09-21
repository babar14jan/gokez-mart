import { View, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';
import { colors } from '@/constants/theme';
import { APP_CONFIG } from '@/constants/config';

const HIDE_WEB_HEADERS = `
  (function() {
    function addStyle() {
      if (!document.head) { setTimeout(addStyle, 10); return; }
      if (document.getElementById('gokez-embed-style')) return;
      var style = document.createElement('style');
      style.id = 'gokez-embed-style';
      style.innerHTML = 'header{display:none !important;} div.sticky.top-0{display:none !important;}';
      document.head.appendChild(style);
    }
    addStyle();
  })();
  true;
`;

export default function PrivacyScreen() {
  return (
    <View style={{ flex: 1 }}>
      <WebView
        source={{ uri: `${APP_CONFIG.webUrl}/privacy?embed=1` }}
        injectedJavaScriptBeforeContentLoaded={HIDE_WEB_HEADERS}
        injectedJavaScript={HIDE_WEB_HEADERS}
        startInLoadingState
        renderLoading={() => (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' }}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        )}
      />
    </View>
  );
}
