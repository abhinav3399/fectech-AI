package ai.factech.android;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register the on-device speech recognizer before the bridge starts so the
        // web layer can use it as soon as the WebView is ready.
        registerPlugin(NativeSpeechPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
