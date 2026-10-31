package ai.factech.android;

import android.Manifest;
import android.content.Intent;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;

/**
 * On-device speech recognition for the Android WebView.
 *
 * Chrome's webkitSpeechRecognition is not available inside an Android WebView,
 * so live voice needs the platform SpeechRecognizer. This plugin keeps the audio
 * pipeline on the device: no audio is uploaded to a speech cloud service.
 */
@CapacitorPlugin(
        name = "NativeSpeech",
        permissions = {
                @Permission(alias = "microphone", strings = {Manifest.permission.RECORD_AUDIO})
        }
)
public class NativeSpeechPlugin extends Plugin implements RecognitionListener {

    private SpeechRecognizer recognizer;
    private PluginCall startCall;
    private boolean listening = false;

    private void ensureRecognizer() {
        if (recognizer == null) {
            recognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
            recognizer.setRecognitionListener(this);
        }
    }

    private void releaseRecognizer() {
        if (recognizer != null) {
            try {
                recognizer.cancel();
                recognizer.destroy();
            } catch (Exception ignored) {
            }
            recognizer = null;
        }
        listening = false;
    }

    @PluginMethod
    public void available(PluginCall call) {
        JSObject result = new JSObject();
        result.put("available", SpeechRecognizer.isRecognitionAvailable(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void checkPermissions(PluginCall call) {
        JSObject result = new JSObject();
        result.put("microphone", getPermissionState("microphone").toString());
        call.resolve(result);
    }

    @PluginMethod
    public void requestPermissions(PluginCall call) {
        if (getPermissionState("microphone") == com.getcapacitor.PermissionState.GRANTED) {
            JSObject result = new JSObject();
            result.put("microphone", "granted");
            call.resolve(result);
            return;
        }
        requestPermissionForAlias("microphone", call, "microphoneCallback");
    }

    @PermissionCallback
    private void microphoneCallback(PluginCall call) {
        JSObject result = new JSObject();
        result.put("microphone", getPermissionState("microphone").toString());
        call.resolve(result);
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (getPermissionState("microphone") != com.getcapacitor.PermissionState.GRANTED) {
            call.reject("microphone_permission_denied");
            return;
        }
        if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
            call.reject("speech_recognition_unavailable");
            return;
        }
        String lang = call.getString("language", "en-IN");
        Boolean partial = call.getBoolean("partialResults", true);

        getActivity().runOnUiThread(() -> {
            releaseRecognizer();
            ensureRecognizer();
            startCall = call;
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, lang);
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, partial);
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
            intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 1200L);
            try {
                recognizer.startListening(intent);
            } catch (Exception error) {
                if (startCall != null) {
                    startCall.reject("speech_start_failed: " + error.getMessage());
                    startCall = null;
                }
            }
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (recognizer != null && listening) {
                try {
                    recognizer.stopListening();
                } catch (Exception ignored) {
                }
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            releaseRecognizer();
            call.resolve();
        });
    }

    @Override
    protected void handleOnDestroy() {
        releaseRecognizer();
        super.handleOnDestroy();
    }

    private void emit(String event, String text, String error) {
        JSObject data = new JSObject();
        if (text != null) data.put("text", text);
        if (error != null) data.put("error", error);
        notifyListeners(event, data);
    }

    private String firstResult(Bundle results) {
        if (results == null) return "";
        ArrayList<String> matches = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        return (matches != null && !matches.isEmpty() && matches.get(0) != null) ? matches.get(0).trim() : "";
    }

    @Override
    public void onReadyForSpeech(Bundle params) {
        listening = true;
        emit("start", null, null);
        if (startCall != null) {
            startCall.resolve();
            startCall = null;
        }
    }

    @Override
    public void onBeginningOfSpeech() {
    }

    @Override
    public void onRmsChanged(float rmsdB) {
    }

    @Override
    public void onBufferReceived(byte[] buffer) {
    }

    @Override
    public void onEndOfSpeech() {
        listening = false;
    }

    @Override
    public void onError(int error) {
        listening = false;
        String code;
        switch (error) {
            case SpeechRecognizer.ERROR_NO_MATCH:
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                code = "no-speech";
                break;
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                code = "not-allowed";
                break;
            case SpeechRecognizer.ERROR_NETWORK:
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
                code = "network";
                break;
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY:
                code = "busy";
                break;
            case SpeechRecognizer.ERROR_CLIENT:
                code = "aborted";
                break;
            default:
                code = "speech-error-" + error;
        }
        if (startCall != null) {
            startCall.reject(code);
            startCall = null;
        }
        emit("error", null, code);
    }

    @Override
    public void onResults(Bundle results) {
        listening = false;
        String text = firstResult(results);
        if (!text.isEmpty()) emit("result", text, null);
        emit("end", null, null);
    }

    @Override
    public void onPartialResults(Bundle partialResults) {
        String text = firstResult(partialResults);
        if (!text.isEmpty()) emit("partial", text, null);
    }

    @Override
    public void onEvent(int eventType, Bundle params) {
    }
}
