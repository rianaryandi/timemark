package com.xa.gddo;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(com.xa.gddo.GallerySave.class);
        super.onCreate(savedInstanceState);
    }
}
