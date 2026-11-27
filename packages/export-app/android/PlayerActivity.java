package com.splashanimator.player;

import android.app.Activity;
import android.graphics.Insets;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowInsets;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.Collections;

public final class PlayerActivity extends Activity {
    private static final String ORIGIN = "https://appassets.androidplatform.net/";
    private static final int BACKGROUND = 0xff20232a;
    private WebView player;
    private FrameLayout content;

    @Override
    protected void onCreate(Bundle savedState) {
        super.onCreate(savedState);
        content = new FrameLayout(this);
        content.setBackgroundColor(BACKGROUND);
        content.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                Insets safe = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
            } else {
                view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });
        player = new WebView(this);
        player.setBackgroundColor(BACKGROUND);
        WebSettings settings = player.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUseWideViewPort(true);
        player.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return true;
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if ("GET".equals(request.getMethod())) {
                    String url = request.getUrl().toString();
                    try {
                        if ((ORIGIN + "index.html").equals(url)) {
                            return new WebResourceResponse("text/html", "UTF-8", getAssets().open("index.html"));
                        }
                        if ((ORIGIN + "player.js").equals(url)) {
                            return new WebResourceResponse("text/javascript", "UTF-8", getAssets().open("player.js"));
                        }
                    } catch (IOException ignored) {
                        // Missing bundled resources must not fall through to the network.
                    }
                }
                return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
                    Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
            }
        });
        content.addView(player, new FrameLayout.LayoutParams(-1, -1));
        setContentView(content);
        player.loadUrl(ORIGIN + "index.html");
    }

    @Override
    protected void onPause() {
        player.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        player.onResume();
    }

    @Override
    protected void onDestroy() {
        content.removeView(player);
        player.destroy();
        super.onDestroy();
    }
}
