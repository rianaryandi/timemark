package com.timemark.foto;

import android.content.ContentValues;
import android.content.Context;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.IOException;
import java.io.OutputStream;

/**
 * Simpan foto langsung ke MediaStore (galeri / kamera perangkat).
 * Digunakan supaya hasil stempel masuk ke penyimpanan kamera (DCIM/Camera).
 */
@CapacitorPlugin(name = "GallerySave")
public class GallerySave extends Plugin {

    private static final String DEFAULT_DIR = "Pictures/TimemarkFoto";
    private static final String CAMERA_DIR = "DCIM/Camera";

    @PluginMethod
    public void save(PluginCall call) {
        String data = call.getString("data");
        String fileName = call.getString("fileName");
        Boolean toCamera = call.getBoolean("toCamera", false);

        if (data == null || fileName == null) {
            call.reject("data & fileName wajib diisi");
            return;
        }

        try {
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            Context ctx = getContext();
            String relativePath = (toCamera != null && toCamera) ? CAMERA_DIR : DEFAULT_DIR;

            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
            values.put(MediaStore.MediaColumns.MIME_TYPE, "image/jpeg");

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                values.put(MediaStore.MediaColumns.RELATIVE_PATH, relativePath);
                values.put(MediaStore.MediaColumns.IS_PENDING, 1);
            }

            Uri collection = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                ? MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                : MediaStore.Images.Media.EXTERNAL_CONTENT_URI;

            Uri item = ctx.getContentResolver().insert(collection, values);
            if (item == null) {
                call.reject("Gagal membuat entri MediaStore");
                return;
            }

            try (OutputStream os = ctx.getContentResolver().openOutputStream(item)) {
                if (os == null) throw new IOException("openOutputStream null");
                os.write(bytes);
                os.flush();
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues clearPending = new ContentValues();
                clearPending.put(MediaStore.MediaColumns.IS_PENDING, 0);
                ctx.getContentResolver().update(item, clearPending, null, null);
            } else {
                String path = null;
                try (android.database.Cursor c = ctx.getContentResolver()
                        .query(item, new String[]{MediaStore.MediaColumns.DATA}, null, null, null)) {
                    if (c != null && c.moveToFirst()) path = c.getString(0);
                }
                if (path != null) {
                    MediaScannerConnection.scanFile(ctx, new String[]{path}, new String[]{"image/jpeg"}, null);
                }
            }

            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("uri", item.toString());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Gagal simpan ke galeri: " + e.getMessage());
        }
    }
}
