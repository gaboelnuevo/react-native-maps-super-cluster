'use-strict'

// base libs
import PropTypes from 'prop-types'
import React, { PureComponent } from 'react'
import {
  Platform,
  Dimensions,
  LayoutAnimation
} from 'react-native'
// map-related libs
import MapView, { Polyline} from 'react-native-maps'
import SuperCluster from 'supercluster'
import GeoViewport from '@mapbox/geo-viewport'
// components / views
import ClusterMarker from './ClusterMarker'
// libs / utils
import {
  regionToBoundingBox,
  itemToGeoJSONFeature,
  haversineDistance,
  averageGeolocation
} from './util'

import _ from "lodash";

export default class ClusteredMapView extends PureComponent {

  constructor(props) {
    super(props)

    this.state = {
      data: [], // helds renderable clusters and markers
      region: props.region || props.initialRegion, // helds current map region
    }

    this.isAndroid = Platform.OS === 'android'
    this.dimensions = [props.width, props.height]

    this.mapRef = this.mapRef.bind(this)
    this.onClusterPress = this.onClusterPress.bind(this)
    this.onRegionChangeComplete = this.onRegionChangeComplete.bind(this)
  }

  componentDidMount() {
    this.clusterize(this.props.data);
  }

  componentWillReceiveProps(nextProps) {
    if (this.props.data !== nextProps.data) {
      this.clusterize(nextProps.data.slice());
    }
  }

  componentWillUpdate(nextProps, nextState) {
    !this.isAndroid && this.props.animateClusters
                    && this.clustersChanged(nextState)
                    && LayoutAnimation.configureNext(LayoutAnimation.Presets.spring)
  }

  mapRef = (ref) => {
    this.mapview = ref
  }

  getMapRef = () => this.mapview

  getClusteringEngine = () => this.index

  clusterize = (dataset) => {
    this.index = SuperCluster({ // eslint-disable-line new-cap
      extent: this.props.extent,
      minZoom: this.props.minZoom,
      maxZoom: this.props.maxZoom,
      radius: this.props.radius || (this.dimensions[0] * .045), // 4.5% of screen width
    })

    // get formatted GeoPoints for cluster
    const rawData = dataset.slice().map(itemToGeoJSONFeature);

    // load geopoints into SuperCluster
    this.index.load(rawData);

    const data = this.getClusters(this.state.region)
    this.setState({ data });
    this.unspiderfy();
  }

  clustersChanged = (nextState) => this.state.data.length !== nextState.data.length

  onRegionChangeComplete = (region) => {
    let data;

    let currentZoomLevel = this.getZoomLevel(region);
    let spiderfiedZoomLevel = this.state.spiderfiedZoomLevel;

    if (region.longitudeDelta <= 80) {
      data = this.getClusters(region)
      this.setState({ region, data });
    }

    if (spiderfiedZoomLevel && Math.abs(spiderfiedZoomLevel - currentZoomLevel) >= 1) {
      this.unspiderfy();
    }

    this.props.onRegionChangeComplete && this.props.onRegionChangeComplete(region, data);
  }

  getZoomLevel (region) {
    let zoomLevel = region && Math.round(
      Math.log(360 / region.longitudeDelta) / Math.LN2
    );
    return zoomLevel;
  }

  getClusters = (region) => {
    const bbox = regionToBoundingBox(region),
          viewport = (region.longitudeDelta) >= 40 ? { zoom: this.props.minZoom } : GeoViewport.viewport(bbox, this.dimensions)

    return this.index.getClusters(bbox, viewport.zoom)
  }

  onPressMarker = (item) => {
    let spiderfiedPoints = this.state.spiderfiedPoints;
    let spiderfiedPoint = spiderfiedPoints && spiderfiedPoints[item.id];

    if (!spiderfiedPoint || (spiderfiedPoint.id != item.id)) {
      // remenber that the same item is included
      let pointsOverlapped = this.state.data.filter((d) => {
        if (d.properties.point_count) return false;
        return this.isOverlapped(d.properties.item, item);
      });

      let otherNearPoints = [];

/*       pointsOverlapped.forEach((point) => {
        this.state.data.forEach((d) => {
          if (d.properties.point_count) return;
          if(this.isOverlapped(d.properties.item, point.properties.item)) {
            otherNearPoints.push(d);
          }
        });
      });
 */
      if (pointsOverlapped.length > 1) {
        this.spiderfy(_.uniqBy(pointsOverlapped.slice().concat(otherNearPoints), (d) => d.properties.item.id));
      } else {
        this.unspiderfy();
      }
    } else {
      this.unspiderfy();
    }
  }

  unspiderfy() {
    this.setState({
      spiderfiedPoints: null,
      spiderfiedZoomLevel: null,
      spiderLines: null
    });
  }

  spiderfy(pointsOverlapped=[]) {
    const centerPt = averageGeolocation(pointsOverlapped.map(d => d.properties.item.location));
    const count = pointsOverlapped.length;
    const circleStartAngle = Math.PI / 4;
    const generatePtsCircle = () => {
      let angleStep = (Math.PI * 2) / count;
      return pointsOverlapped
        .map(d => {
          return d.properties.item;
        })
        .map((point, index) => {
          let angle = circleStartAngle + index * angleStep;
          let circumference = (this.convertPixelsToKMs(30) * 1000) * (2 + count);
          let radius = circumference / (Math.PI * 2);
          return {
            ...point,
            origin: centerPt,
            location: {
              latitude:
                centerPt.latitude + ((radius / 111300) * Math.cos(angle)),
              longitude:
                centerPt.longitude + ((radius / 111300) * Math.sin(angle))
            }
          };
        });
    };

    let spiderfiedPoints = generatePtsCircle();

    this.setState({
      spiderfiedPoints: null
    }, () => {
      this.setState({
        spiderfiedPoints: _.keyBy(spiderfiedPoints, 'id'),
        spiderfiedZoomLevel: this.getZoomLevel(this.state.region),
        spiderLines: spiderfiedPoints.map((p) => {
          return {
            id: `line-${p.id}`,
            origin: p.origin,
            location: p.location
          }
        }),
      });
    });
  }

  onClusterPress = (cluster) => {

    // cluster press behavior might be extremely custom.
    if (!this.props.preserveClusterPressBehavior) {
      this.props.onClusterPress && this.props.onClusterPress(cluster.properties.cluster_id)
      return
    }

    // //////////////////////////////////////////////////////////////////////////////////
    // NEW IMPLEMENTATION (with fitToCoordinates)
    // //////////////////////////////////////////////////////////////////////////////////
    // get cluster children
    const children = this.index.getLeaves(cluster.properties.cluster_id, this.props.clusterPressMaxChildren),
          markers = children.map(c => c.properties.item)

    // fit right around them, considering edge padding
    this.mapview.fitToCoordinates(markers.map(m => m.location), { edgePadding: this.props.edgePadding })

    this.props.onClusterPress && this.props.onClusterPress(cluster.properties.cluster_id, markers)
  }

  convertPixelsToKMs (pixels, region=null) {
    let _region = region || this.state.region;
    if (_region) {
      let bbox = regionToBoundingBox(_region);
      return pixels * (haversineDistance([bbox[1], bbox[0]], [bbox[3], bbox[2]]) / Math.hypot(...this.dimensions));
    }
    return null;
  }

  convertKMsToPixels (kms) {
    return kms / this.convertPixelsToKMs(1);
  }

  isOverlapped (p1, p2) {
    if (p1.location && p2.location) {
      return haversineDistance([p1.location.latitude, p1.location.longitude], [p2.location.latitude, p2.location.longitude]) <= this.convertPixelsToKMs(15);
    }

    return false;
  }

  renderMarker (item) {
    let spiderfiedPoints = this.state.spiderfiedPoints;
    let spiderfiedPoint = spiderfiedPoints && spiderfiedPoints[item.id];
    return this.props.renderMarker(spiderfiedPoint || item, this.onPressMarker, !!spiderfiedPoint);
  }

  renderSpiderLines () {
    const lines = this.state.spiderLines || [];
    return lines.map(line => {
      return (
        <Polyline
          key={`line-${line.id}`}
          strokeWidth={2}
          strokeColor={"gray"}
          coordinates={[line.origin, line.location]}
        />
      );
    })
  }

  render() {
    return (
      <MapView
        { ...this.props}
        ref={this.mapRef}
        onRegionChangeComplete={this.onRegionChangeComplete}>
        {
          this.props.clusteringEnabled && this.state.data.map((d) => {
            if (d.properties.point_count === 0)
              return this.renderMarker(d.properties.item);

            return (
              <ClusterMarker
                {...d}
                onPress={this.onClusterPress}
                textStyle={this.props.textStyle}
                scaleUpRatio={this.props.scaleUpRatio}
                renderCluster={this.props.renderCluster}
                key={`cluster-${d.properties.cluster_id}`}
                containerStyle={this.props.containerStyle}
                clusterInitialFontSize={this.props.clusterInitialFontSize}
                clusterInitialDimension={this.props.clusterInitialDimension} />
            )
          })
        }
        {
          !this.props.clusteringEnabled && this.props.data.map(d => this.props.renderMarker(d))
        }
        {this.props.children}
        {this.renderSpiderLines()}
      </MapView>
    )
  }
}

ClusteredMapView.defaultProps = {
  minZoom: 1,
  maxZoom: 20,
  extent: 512,
  textStyle: {},
  containerStyle: {},
  animateClusters: true,
  clusteringEnabled: true,
  clusterInitialFontSize: 12,
  clusterInitialDimension: 30,
  clusterPressMaxChildren: 100,
  preserveClusterPressBehavior: true,
  width: Dimensions.get('window').width,
  height: Dimensions.get('window').height,
  edgePadding: { top: 10, left: 10, right: 10, bottom: 10 }
}

ClusteredMapView.propTypes = {
  ...MapView.propTypes,
  // number
  radius: PropTypes.number,
  width: PropTypes.number.isRequired,
  height: PropTypes.number.isRequired,
  extent: PropTypes.number.isRequired,
  minZoom: PropTypes.number.isRequired,
  maxZoom: PropTypes.number.isRequired,
  clusterInitialFontSize: PropTypes.number.isRequired,
  clusterPressMaxChildren: PropTypes.number.isRequired,
  clusterInitialDimension: PropTypes.number.isRequired,
  // array
  data: PropTypes.array.isRequired,
  // func
  onExplode: PropTypes.func,
  onImplode: PropTypes.func,
  scaleUpRatio: PropTypes.func,
  renderCluster: PropTypes.func,
  onClusterPress: PropTypes.func,
  renderMarker: PropTypes.func.isRequired,
  // bool
  animateClusters: PropTypes.bool.isRequired,
  clusteringEnabled: PropTypes.bool.isRequired,
  preserveClusterPressBehavior: PropTypes.bool.isRequired,
  // object
  textStyle: PropTypes.object,
  edgePadding: PropTypes.object.isRequired,
  containerStyle: PropTypes.object,
  // string
}
