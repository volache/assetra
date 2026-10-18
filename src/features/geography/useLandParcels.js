import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabase";
import { landAssetNumberParts } from "./landLabels";

const emptyFeatureCollection = { type: "FeatureCollection", features: [] };

// One map feature from the database, flattened into the row shape the lists use.
function landFromFeature(feature, index) {
  const basic = feature.properties?.basic_info || {};
  const property = feature.properties?.property_info || {};
  const propertyNumber =
    property.property_number || `${basic.section_code}-${basic.land_number}-${index}`;
  const number = landAssetNumberParts(propertyNumber);
  return {
    announcedLandPrice: Number(basic.announced_land_price) || 0,
    announcedLandValue: Number(basic.announced_land_value) || 0,
    area: Number(basic.area) || 0,
    feature,
    documentLandParcelId: feature.properties?.land_parcel_id || null,
    // Identity of the parcel on the map and in the lists.  The 財產編號 is
    // not unique here: 120-1040103-0001-0000004 and 200-1040103-0001-0000004
    // both shorten to the same displayed number.
    id: feature.properties?.land_parcel_id || `${basic.section_code}-${basic.land_number}`,
    assetNumber: number.serial ? `${number.primary}\n${number.serial}` : number.primary,
    propertyNumber: String(property.property_number || ""),
    landNumber: basic.land_number || "—",
    landUseType: basic.land_use_type || "—",
    name: property.property_name || "未命名土地",
    price: Number(property.property_value) || 0,
    relatedBuildingNumbers: feature.properties?.related_building_numbers?.join("、") || "—",
    section: basic.section_name || "未分類段",
    sectionCode: basic.section_code || "—",
    zoning: `${basic.zoning || "未分類"}\n${basic.land_use_type || "—"}`,
    zoningLabel: basic.zoning || "未分類",
  };
}

// Loads the published land parcels and keeps them as map features plus list rows.
// Call `reload()` after a parcel was saved to fetch the list again.
export function useLandParcels() {
  const [landProperties, setLandProperties] = useState(emptyFeatureCollection);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const lands = useMemo(() => landProperties.features.map(landFromFeature), [landProperties]);

  useEffect(() => {
    let isCurrent = true;

    async function loadLandProperties() {
      if (!supabase) {
        if (isCurrent) {
          setError("尚未設定 Supabase 連線，無法讀取地籍資料。");
          setIsLoading(false);
        }
        return;
      }

      setIsLoading(true);
      setError("");
      const { data, error: loadError } = await supabase
        .from("land_parcel_features")
        .select("id, feature")
        .order("parcel_key");

      if (!isCurrent) return;
      if (loadError) {
        setError("地籍資料讀取失敗，請重新整理後再試。");
        setLandProperties(emptyFeatureCollection);
      } else {
        setLandProperties({
          type: "FeatureCollection",
          features: (data || []).flatMap((row) => {
            if (!row.feature) return [];
            return [
              {
                ...row.feature,
                properties: { ...row.feature.properties, land_parcel_id: row.id },
              },
            ];
          }),
        });
      }
      setIsLoading(false);
    }

    loadLandProperties();
    return () => {
      isCurrent = false;
    };
  }, [reloadKey]);

  return {
    landProperties,
    lands,
    isLoading,
    error,
    reload: () => setReloadKey((key) => key + 1),
  };
}
