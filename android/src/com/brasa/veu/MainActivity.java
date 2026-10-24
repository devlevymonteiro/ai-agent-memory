package com.brasa.veu;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * Casca nativa minima para o jogo "BRASA - O Veu do Esquecimento".
 * O jogo em si roda 100% offline em HTML/JS dentro de uma WebView.
 * Esta Activity so: tela cheia, WebView, ponte de save (SharedPreferences)
 * e tratamento do botao Voltar -> menu de pausa do jogo.
 */
public class MainActivity extends Activity {

    private WebView web;

    /** Ponte de persistencia: garante que o "save" sobreviva mesmo em file://. */
    public static final class Store {
        private final Context ctx;
        Store(Context c) { ctx = c; }
        private SharedPreferences prefs() {
            return ctx.getSharedPreferences("brasa_save", Context.MODE_PRIVATE);
        }
        @JavascriptInterface
        public void put(String key, String value) {
            prefs().edit().putString(key, value).apply();
        }
        @JavascriptInterface
        public String get(String key) {
            return prefs().getString(key, null);
        }
        @JavascriptInterface
        public void remove(String key) {
            prefs().edit().remove(key).apply();
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN,
                WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        s.setLoadWithOverviewMode(false);
        s.setUseWideViewPort(true);
        // fundo escuro evita flash branco antes do canvas pintar
        web.setBackgroundColor(0xFF120b17);
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient());
        web.addJavascriptInterface(new Store(this), "BrasaStore");

        // Interface de voltar/pausa para o JS
        // (evaluateJavascript e chamado em onBackPressed)

        setContentView(web);
        applyImmersive();

        if (savedInstanceState == null) {
            web.loadUrl("file:///android_asset/index.html");
        }
    }

    private void applyImmersive() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
              | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
              | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
              | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
              | View.SYSTEM_UI_FLAG_FULLSCREEN
              | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) applyImmersive();
    }

    @Override
    public void onBackPressed() {
        // Deixa o jogo decidir: abre/fecha o menu de pausa.
        if (web != null) {
            web.evaluateJavascript(
                "(function(){ if(window.BrasaBack){ window.BrasaBack(); return 'ok'; } return 'no'; })()",
                null);
        }
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            onBackPressed();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) web.evaluateJavascript(
            "(function(){ if(window.BrasaPause) window.BrasaPause(); })()", null);
    }
}
