import json
import os

geo_path = os.path.join("frontend", "public", "geo", "nigeria-lga.geojson")

if not os.path.exists(geo_path):
    print(f"[ERROR] Could not find geojson at {geo_path}")
else:
    with open(geo_path, "r", encoding="utf-8") as f:
        data = json.load(f)
        
    features = data.get("features", [])
    print(f"[INFO] Total LGA polygons found in GeoJSON: {len(features)}")
    
    if len(features) > 0:
        print("[INFO] Sample feature property keys:")
        print(list(features[0]["properties"].keys()))
        
        print("\n[INFO] Sample LGA names in GeoJSON:")
        for feat in features[:5]:
            props = feat["properties"]
            # Print whatever looks like a name field
            name = props.get("NAME_2") or props.get("admin2Name") or props.get("NAME") or props.get("LGA") or list(props.values())[0]
            print(f" - {name}")